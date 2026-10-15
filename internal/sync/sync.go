// Package sync 实现 WebDAV 双向同步引擎（旧 server/src/sync.ts）。
//
// 一次同步周期（进程内串行）：
//  1. PROPFIND(Depth:1) 取最新备份；
//  2. 与上次处理过的（meta 记录 etag/getlastmodified + 文件名）比对，未变则跳过下载；
//  3. 下载 → 解密 → 解 zip → 解析 metadata.json；
//  4. 与库内数据走 data.MergeData 条目级合并；有变化才落库并 revision++；
//  5. 有变化或本机有待上传改动时，上传一份新包；
//  6. 按保留份数只清理本服务上传过的旧包（绝不碰安卓端的历史备份）。
//
// 连接与参数来自 settings 包的库内设置，环境变量只作首次默认值；每个动作前重新读取，改完立即生效。
// 任何异常都不致命：脱敏记日志 + 写状态 + 下轮继续 + 指数退避（上限 4× 间隔）。
package sync

import (
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"reminderweb-go/internal/config"
	"reminderweb-go/internal/settings"
	"reminderweb-go/internal/store"
	"reminderweb-go/internal/syncconfig"
	"reminderweb-go/internal/webdav"
)

// SyncAction 是最近一次同步 / 备份的动作。
type SyncAction string

// 动作取值。
const (
	ActionUpload  SyncAction = "upload"
	ActionPull    SyncAction = "pull"
	ActionRestore SyncAction = "restore"
	ActionNone    SyncAction = "none"
)

// SyncStatus 是对外同步状态。
type SyncStatus struct {
	Enabled        bool               `json:"enabled"`
	URL            string             `json:"url"`
	LastSyncAt     *int64             `json:"lastSyncAt"`
	LastUploadAt   *int64             `json:"lastUploadAt"`
	LastResult     *string            `json:"lastResult"`
	LastError      *string            `json:"lastError"`
	PendingChanges bool               `json:"pendingChanges"`
	RemoteFiles    []RemoteFileStatus `json:"remoteFiles"`
	NextSyncAt     *int64             `json:"nextSyncAt"`
	LastMerged     int64              `json:"lastMerged"`
	LastAction     SyncAction         `json:"lastAction"`
}

// RemoteFileStatus 是状态里的远端文件简表。
type RemoteFileStatus struct {
	Name       string `json:"name"`
	ModifiedAt int64  `json:"modifiedAt"`
}

// RemoteBackupEntry 是云端备份条目（供 GET /api/sync/files）。
type RemoteBackupEntry struct {
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	ModifiedAt int64  `json:"modifiedAt"`
}

// AppliedCounts 是恢复带来的条目变化计数。
type AppliedCounts struct {
	Updated  int `json:"updated"`
	Added    int `json:"added"`
	Removed  int `json:"removed"`
	Rejected int `json:"rejected"`
}

// RestoreResult 是从备份恢复的结果。
type RestoreResult struct {
	Applied  AppliedCounts `json:"applied"`
	Revision int64         `json:"revision"`
}

// UploadResult 是立即备份的结果。
type UploadResult struct {
	Name         string `json:"name"`
	Size         int64  `json:"size"`
	LastUploadAt *int64 `json:"lastUploadAt"`
}

// ActionError 是手动云端操作（恢复 / 删除）失败：Status + 稳定错误码 + 中文文案。
type ActionError struct {
	Status  int
	Code    string
	Message string
}

func (e *ActionError) Error() string { return e.Message }

// Deps 是引擎外部依赖（测试注入假 WebDAV 与固定时钟）。
type Deps struct {
	Client *http.Client
	// Now 固定「现在」，便于测试确定性文件名与退避。
	Now func() int64
}

// 元数据键。
const (
	metaLastProcessed = "sync.lastProcessed"
	metaUploaded      = "sync.uploaded"
	metaLastSyncAt    = "sync.lastSyncAt"
	metaLastUploadAt  = "sync.lastUploadAt"
	metaLastResult    = "sync.lastResult"
	metaLastError     = "sync.lastError"
	metaLastMerged    = "sync.lastMerged"
	metaLastAction    = "sync.lastAction"
)

type processedMarker struct {
	Name         string  `json:"name"`
	LastModified int64   `json:"lastModified"`
	ETag         *string `json:"etag"`
}

// Engine 是同步引擎。
type Engine struct {
	config *config.Config
	db     *store.DB
	logger *slog.Logger
	deps   Deps

	mu       sync.Mutex
	running  bool
	pending  bool
	debounce *time.Timer
	poll     *time.Timer
	backoff  int64

	remoteFiles []webdav.RemoteFile
	settings    settings.ServerSettings
	intervalMS  int64
	nextPollAt  *int64

	debounceMS int64
}

// New 创建同步引擎。
func New(cfg *config.Config, db *store.DB, logger *slog.Logger, deps Deps) *Engine {
	engine := &Engine{
		config:     cfg,
		db:         db,
		logger:     logger,
		deps:       deps,
		debounceMS: int64(cfg.WebDAVDebounceSeconds) * 1000,
	}
	engine.settings = settings.ReadServerSettings(db, cfg)
	engine.intervalMS = int64(engine.settings.WebdavIntervalMinutes) * 60_000
	engine.backoff = engine.intervalMS
	return engine
}

func (e *Engine) now() int64 {
	if e.deps.Now != nil {
		return e.deps.Now()
	}
	return time.Now().UnixMilli()
}

func (e *Engine) current() settings.ServerSettings {
	return settings.ReadServerSettings(e.db, e.config)
}

func (e *Engine) enabledLocked() bool { return e.settings.WebdavEnabled }

func (e *Engine) webdavClient(value settings.ServerSettings) webdav.Config {
	return webdav.Config{
		URL:       value.WebdavURL,
		Username:  value.WebdavUsername,
		Password:  value.WebdavPassword,
		TimeoutMS: e.config.WebDAVTimeoutSeconds * 1000,
	}
}

func (e *Engine) webdavDeps() webdav.Deps {
	return webdav.Deps{Client: e.deps.Client}
}

// ConfigView 返回当前同步配置视图（不含凭据）。
func (e *Engine) ConfigView() syncconfig.SyncConfigView {
	e.mu.Lock()
	defer e.mu.Unlock()
	return buildConfigView(e.settings)
}

// UpdateConfig 更新同步配置并立即重排定时器；非法值返回 SyncConfigError。
func (e *Engine) UpdateConfig(raw any) (syncconfig.SyncConfigView, error) {
	patch, err := parseConfigPatch(raw)
	if err != nil {
		return syncconfig.SyncConfigView{}, err
	}
	e.mu.Lock()
	previousEnabled := e.settings.WebdavEnabled
	e.mu.Unlock()
	if err := applyConfigPatch(e.db, e.config, patch); err != nil {
		return syncconfig.SyncConfigView{}, err
	}
	e.mu.Lock()
	e.settings = e.current()
	e.applyScheduleLocked(previousEnabled)
	view := buildConfigView(e.settings)
	e.mu.Unlock()
	return view, nil
}

// ReloadSettings 外部（页面）改动设置后调用：重读设置并立即重排定时器。
func (e *Engine) ReloadSettings() {
	e.mu.Lock()
	previousEnabled := e.settings.WebdavEnabled
	e.settings = e.current()
	e.applyScheduleLocked(previousEnabled)
	e.mu.Unlock()
}

func (e *Engine) applyScheduleLocked(previousEnabled bool) {
	e.intervalMS = int64(e.settings.WebdavIntervalMinutes) * 60_000
	e.backoff = e.intervalMS
	if !e.settings.WebdavEnabled {
		e.clearPollLocked()
		e.clearDebounceLocked()
		e.nextPollAt = nil
		return
	}
	if !previousEnabled {
		e.schedulePollLocked(0)
	} else {
		e.schedulePollLocked(e.intervalMS)
	}
	if e.pending {
		e.scheduleDebounceLocked()
	}
}

func (e *Engine) clearPollLocked() {
	if e.poll != nil {
		e.poll.Stop()
		e.poll = nil
	}
}

func (e *Engine) clearDebounceLocked() {
	if e.debounce != nil {
		e.debounce.Stop()
		e.debounce = nil
	}
}

func (e *Engine) schedulePollLocked(delayMS int64) {
	e.clearPollLocked()
	if delayMS < 0 {
		delayMS = 0
	}
	next := e.now() + delayMS
	e.nextPollAt = &next
	e.poll = time.AfterFunc(time.Duration(delayMS)*time.Millisecond, func() {
		e.mu.Lock()
		e.poll = nil
		e.nextPollAt = nil
		e.mu.Unlock()
		e.runCycle()
	})
}

func (e *Engine) scheduleDebounceLocked() {
	e.clearDebounceLocked()
	delay := e.debounceMS
	if delay < 0 {
		delay = 0
	}
	e.debounce = time.AfterFunc(time.Duration(delay)*time.Millisecond, func() {
		e.mu.Lock()
		e.debounce = nil
		e.mu.Unlock()
		e.runCycle()
	})
}

// Start 启动：自动同步开启时定时轮询；有待上传改动时按 debounce 排期。
func (e *Engine) Start() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.settings.WebdavEnabled {
		return
	}
	e.schedulePollLocked(e.intervalMS)
	if e.pending {
		e.scheduleDebounceLocked()
	}
}

// Stop 停止所有定时器。
func (e *Engine) Stop() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.clearPollLocked()
	e.clearDebounceLocked()
	e.nextPollAt = nil
}

// MarkLocalChange 本机数据变更：自动同步开启时置 pending 并按 debounce 合并节流。
func (e *Engine) MarkLocalChange() {
	if !e.current().WebdavEnabled {
		return
	}
	e.mu.Lock()
	e.pending = true
	e.scheduleDebounceLocked()
	e.mu.Unlock()
}

// Status 返回当前同步状态。
func (e *Engine) Status() SyncStatus {
	e.mu.Lock()
	enabled := e.settings.WebdavEnabled
	url := ""
	if enabled {
		url = e.settings.WebdavURL
	}
	pending := e.pending
	nextPollAt := e.nextPollAt
	remote := e.remoteFiles
	e.mu.Unlock()

	status := SyncStatus{
		Enabled:        enabled,
		URL:            url,
		PendingChanges: pending,
		RemoteFiles:    make([]RemoteFileStatus, 0, len(remote)),
		NextSyncAt:     nextPollAt,
		LastMerged:     parseNumberOrZero(e.meta(metaLastMerged)),
		LastAction:     parseAction(e.meta(metaLastAction)),
		LastSyncAt:     parseNumber(e.meta(metaLastSyncAt)),
		LastUploadAt:   parseNumber(e.meta(metaLastUploadAt)),
	}
	for _, file := range remote {
		status.RemoteFiles = append(status.RemoteFiles, RemoteFileStatus{Name: file.Name, ModifiedAt: file.LastModified})
	}
	if result := e.meta(metaLastResult); result == "ok" || result == "error" {
		value := result
		status.LastResult = &value
	}
	if lastError := e.meta(metaLastError); lastError != "" {
		value := lastError
		status.LastError = &value
	}
	return status
}

func (e *Engine) meta(key string) string {
	value, ok, err := e.db.Meta(key)
	if err != nil || !ok {
		return ""
	}
	return value
}

func (e *Engine) setMeta(key, value string) {
	if err := e.db.SetMeta(key, value); err != nil {
		e.logger.Warn("写入同步元数据失败", "key", key, "error", err)
	}
}

func (e *Engine) setRemoteFiles(files []webdav.RemoteFile) {
	e.mu.Lock()
	e.remoteFiles = files
	e.mu.Unlock()
}

// begin 尝试进入「执行中」；已在执行返回 false。
func (e *Engine) begin() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.running {
		return false
	}
	e.running = true
	return true
}

func (e *Engine) end() {
	e.mu.Lock()
	e.running = false
	e.mu.Unlock()
}

func (e *Engine) setPending(value bool) {
	e.mu.Lock()
	e.pending = value
	e.mu.Unlock()
}

func (e *Engine) isPending() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.pending
}

func (e *Engine) runCycle() {
	if !e.begin() {
		return
	}
	defer e.end()
	_ = e.execute()
}

// RunNow 立即执行一次双向同步（POST /api/sync/now）；已有任务在跑时返回 (nil,false)。
func (e *Engine) RunNow() (*SyncStatus, bool) {
	if !e.begin() {
		return nil, false
	}
	defer e.end()
	status := e.execute()
	return &status, true
}

func (e *Engine) recordSuccess(action SyncAction, merged int64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.setMeta(metaLastSyncAt, strconv.FormatInt(e.now(), 10))
	e.setMeta(metaLastResult, "ok")
	e.setMeta(metaLastError, "")
	e.setMeta(metaLastMerged, strconv.FormatInt(merged, 10))
	if action != ActionNone {
		e.setMeta(metaLastAction, string(action))
	}
	e.backoff = e.intervalMS
	if e.settings.WebdavEnabled {
		e.schedulePollLocked(e.intervalMS)
	} else {
		e.nextPollAt = nil
	}
}

func (e *Engine) recordError(err error) {
	message := "同步失败，请稍后重试"
	if webdavErr, ok := webdavError(err); ok {
		message = webdavErr.Message
	} else if _, ok := backupFormatError(err); ok {
		message = err.Error()
	}
	e.logger.Warn("WebDAV 同步失败", "error", message)
	e.mu.Lock()
	defer e.mu.Unlock()
	e.setMeta(metaLastSyncAt, strconv.FormatInt(e.now(), 10))
	e.setMeta(metaLastResult, "error")
	e.setMeta(metaLastError, message)
	if e.settings.WebdavEnabled {
		next := e.backoff * 2
		if next < e.intervalMS {
			next = e.intervalMS
		}
		if max := e.intervalMS * 4; next > max {
			next = max
		}
		e.backoff = next
		e.schedulePollLocked(e.backoff)
	} else {
		e.nextPollAt = nil
	}
}

func parseNumber(raw string) *int64 {
	if raw == "" {
		return nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return nil
	}
	return &value
}

func parseNumberOrZero(raw string) int64 {
	if value := parseNumber(raw); value != nil {
		return *value
	}
	return 0
}

func parseAction(raw string) SyncAction {
	switch SyncAction(raw) {
	case ActionUpload, ActionPull, ActionRestore:
		return SyncAction(raw)
	}
	return ActionNone
}
