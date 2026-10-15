package sync

import (
	"errors"
	"sort"
	"strconv"
	"time"

	"reminderweb-go/internal/backup"
	"reminderweb-go/internal/config"
	"reminderweb-go/internal/data"
	"reminderweb-go/internal/settings"
	"reminderweb-go/internal/store"
	"reminderweb-go/internal/syncconfig"
	"reminderweb-go/internal/webdav"
	"reminderweb-go/internal/wire"
)

func buildConfigView(value settings.ServerSettings) syncconfig.SyncConfigView {
	stored := syncconfig.StoredSyncConfig{
		Enabled:         value.WebdavEnabled,
		IntervalMinutes: value.WebdavIntervalMinutes,
		Keep:            value.WebdavKeep,
	}
	return syncconfig.SyncConfigViewFor(stored, value.WebdavURL)
}

func parseConfigPatch(raw any) (syncconfig.SyncConfigPatch, error) {
	return syncconfig.ParseSyncConfigPatch(raw)
}

func applyConfigPatch(db *store.DB, cfg *config.Config, patch syncconfig.SyncConfigPatch) error {
	_, err := syncconfig.ApplySyncConfigPatch(db, cfg, patch)
	return err
}

// execute 串行执行一次同步周期并记录结果。
func (e *Engine) execute() SyncStatus {
	startedAt := e.now()
	action, merged, err := e.runOnce(startedAt)
	if err != nil {
		e.recordError(err)
	} else {
		e.recordSuccess(action, merged)
	}
	return e.Status()
}

func (e *Engine) runOnce(startedAt int64) (SyncAction, int64, error) {
	value := e.current()
	client := e.webdavClient(value)
	deps := e.webdavDeps()

	files, err := webdav.ListBackups(client, deps)
	if err != nil {
		return ActionNone, 0, err
	}
	e.setRemoteFiles(files)

	mergedChanged := false
	var mergedCount int64
	uploaded := false

	if len(files) == 0 {
		// 空远端：上传当前数据作为基线。
		if _, err := e.upload(client, deps, value.WebdavKeep); err != nil {
			return ActionNone, 0, err
		}
		uploaded = true
	} else {
		newest := files[0]
		marker := e.readMarker()
		unchanged := marker != nil &&
			marker.Name == newest.Name &&
			(newest.LastModified == 0 || marker.LastModified == newest.LastModified) &&
			(marker.ETag == nil || newest.ETag == "" || *marker.ETag == newest.ETag)
		if !unchanged {
			content, err := webdav.DownloadFile(client, newest.Name, deps)
			if err != nil {
				return ActionNone, 0, err
			}
			archive, err := backup.DecodeArchive(content)
			if err != nil {
				return ActionNone, 0, err
			}
			updatedAt := newest.LastModified
			if updatedAt == 0 {
				updatedAt = startedAt
			}
			parsed, err := backup.ParseBackupMetadata(archive.MetadataJSON, updatedAt)
			if err != nil {
				return ActionNone, 0, err
			}
			before, err := data.ReadServerData(e.db.SQL())
			if err != nil {
				return ActionNone, 0, err
			}
			outcome := data.MergeData(before, data.MergeInput{
				Reminders: parsed.Reminders,
				Tags:      parsed.Tags,
				Settings:  parsed.Settings,
			})
			if outcome.Changed {
				if _, err := data.WriteMergedData(e.db, outcome); err != nil {
					return ActionNone, 0, err
				}
				mergedChanged = true
			}
			counts := data.CountChanges(before, outcome)
			mergedCount = int64(counts.Updated + counts.Added + counts.Removed)
			e.writeMarker(processedMarker{Name: newest.Name, LastModified: newest.LastModified, ETag: etagPtr(newest.ETag)})
		}

		if mergedChanged || e.isPending() {
			if _, err := e.upload(client, deps, value.WebdavKeep); err != nil {
				return ActionNone, 0, err
			}
			uploaded = true
		}
	}

	action := ActionNone
	if mergedChanged {
		action = ActionPull
	} else if uploaded {
		action = ActionUpload
	}
	return action, mergedCount, nil
}

func (e *Engine) upload(client webdav.Config, deps webdav.Deps, keep int) (UploadResult, error) {
	server, err := data.ReadServerData(e.db.SQL())
	if err != nil {
		return UploadResult{}, err
	}
	metadataJSON, err := backup.BuildBackupMetadata(server)
	if err != nil {
		return UploadResult{}, err
	}
	content, err := backup.EncodeArchive(backup.ArchiveInput{MetadataJSON: metadataJSON}, e.config.WebDAVEncrypt)
	if err != nil {
		return UploadResult{}, err
	}
	fileName := backup.BackupFileName(time.UnixMilli(e.now()))
	if err := webdav.UploadFile(client, content, fileName, deps); err != nil {
		return UploadResult{}, err
	}

	files, err := webdav.ListBackups(client, deps)
	if err != nil {
		return UploadResult{}, err
	}
	e.setRemoteFiles(files)
	var uploadedFile *webdav.RemoteFile
	for i := range files {
		if files[i].Name == fileName {
			uploadedFile = &files[i]
		}
	}
	marker := processedMarker{Name: fileName}
	size := int64(len(content))
	if uploadedFile != nil {
		marker.LastModified = uploadedFile.LastModified
		marker.ETag = etagPtr(uploadedFile.ETag)
		size = uploadedFile.Size
	}
	e.writeMarker(marker)

	uploadedAt := e.now()
	e.setMeta(metaLastUploadAt, strconv.FormatInt(uploadedAt, 10))

	names := []string{fileName}
	for _, existing := range e.uploadedNames() {
		if existing != fileName {
			names = append(names, existing)
		}
	}
	e.saveUploadedNames(names)
	if err := e.prune(client, deps, keep); err != nil {
		return UploadResult{}, err
	}
	e.setPending(false)
	return UploadResult{Name: fileName, Size: size, LastUploadAt: &uploadedAt}, nil
}

// prune 仅清理本服务上传过的旧包，保留最新 keep 份。
func (e *Engine) prune(client webdav.Config, deps webdav.Deps, keep int) error {
	effectiveKeep := keep
	if effectiveKeep < 1 {
		effectiveKeep = 1
	}
	names := uniqueStrings(e.uploadedNames())
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	kept := names
	if len(names) > effectiveKeep {
		kept = names[:effectiveKeep]
	}
	remoteSet := map[string]bool{}
	for _, file := range e.remoteFilesSnapshot() {
		remoteSet[file.Name] = true
	}
	for _, name := range names[len(kept):] {
		if !remoteSet[name] {
			continue
		}
		if err := webdav.DeleteFile(client, name, deps); err != nil {
			if _, ok := webdavError(err); !ok {
				return err
			}
		}
	}
	e.saveUploadedNames(kept)
	return nil
}

// ListFiles 列出云端备份（时间倒序）。
func (e *Engine) ListFiles() ([]RemoteBackupEntry, error) {
	value := e.current()
	client := e.webdavClient(value)
	deps := e.webdavDeps()
	files, err := webdav.ListBackups(client, deps)
	if err != nil {
		return nil, err
	}
	e.setRemoteFiles(files)
	out := make([]RemoteBackupEntry, 0, len(files))
	for _, file := range files {
		out = append(out, RemoteBackupEntry{Name: file.Name, Size: file.Size, ModifiedAt: file.LastModified})
	}
	return out, nil
}

// RunUpload 只上传不拉取（POST /api/sync/upload）；已有任务在跑时返回 (nil,false)。
func (e *Engine) RunUpload() (*UploadResult, bool, error) {
	if !e.begin() {
		return nil, false, nil
	}
	defer e.end()
	value := e.current()
	client := e.webdavClient(value)
	deps := e.webdavDeps()
	info, err := e.upload(client, deps, value.WebdavKeep)
	if err != nil {
		return nil, true, err
	}
	e.setMeta(metaLastAction, string(ActionUpload))
	return &info, true, nil
}

// Restore 从指定远端备份恢复；绝不删除远端文件。重复恢复同一份幂等。
func (e *Engine) Restore(name string) (*RestoreResult, bool, error) {
	if !webdav.IsValidBackupName(name) {
		return nil, false, &ActionError{Status: 400, Code: "invalid_name", Message: "备份文件名不合法"}
	}
	if !e.begin() {
		return nil, false, nil
	}
	defer e.end()

	value := e.current()
	client := e.webdavClient(value)
	deps := e.webdavDeps()
	files, err := webdav.ListBackups(client, deps)
	if err != nil {
		return nil, false, err
	}
	e.setRemoteFiles(files)
	var target *webdav.RemoteFile
	for i := range files {
		if files[i].Name == name {
			target = &files[i]
		}
	}
	if target == nil {
		return nil, false, &ActionError{Status: 404, Code: "not_found", Message: "云端没有这份备份"}
	}
	content, err := webdav.DownloadFile(client, name, deps)
	if err != nil {
		return nil, false, err
	}
	archive, err := backup.DecodeArchive(content)
	if err != nil {
		message := "无法识别该备份包"
		if _, ok := backupFormatError(err); ok {
			message = err.Error()
		}
		return nil, false, &ActionError{Status: 400, Code: "invalid_backup", Message: "该备份无法解析：" + message}
	}
	updatedAt := target.LastModified
	if updatedAt <= 0 {
		updatedAt = e.now()
	}
	parsed, err := backup.ParseBackupMetadata(archive.MetadataJSON, updatedAt)
	if err != nil {
		return nil, false, err
	}
	before, err := data.ReadServerData(e.db.SQL())
	if err != nil {
		return nil, false, err
	}
	outcome := data.MergeData(before, data.MergeInput{
		Reminders: parsed.Reminders,
		Tags:      parsed.Tags,
		Settings:  parsed.Settings,
	})
	revision, err := data.WriteMergedData(e.db, outcome)
	if err != nil {
		return nil, false, err
	}
	counts := data.CountChanges(before, outcome)
	e.setMeta(metaLastMerged, strconv.Itoa(counts.Updated+counts.Added+counts.Removed))
	e.setMeta(metaLastAction, string(ActionRestore))
	return &RestoreResult{
		Applied:  AppliedCounts{Updated: counts.Updated, Added: counts.Added, Removed: counts.Removed, Rejected: parsed.Rejected},
		Revision: revision,
	}, true, nil
}

// DeleteRemote 删除云端备份；任何本应用备份都可删除，但绝不碰同目录其它文件。
func (e *Engine) DeleteRemote(name string) (bool, error) {
	if !webdav.IsValidBackupName(name) {
		return false, &ActionError{Status: 400, Code: "invalid_name", Message: "备份文件名不合法"}
	}
	if !e.begin() {
		return false, nil
	}
	defer e.end()

	value := e.current()
	client := e.webdavClient(value)
	deps := e.webdavDeps()
	files, err := webdav.ListBackups(client, deps)
	if err != nil {
		return false, err
	}
	e.setRemoteFiles(files)
	found := false
	for _, file := range files {
		if file.Name == name {
			found = true
		}
	}
	if !found {
		return false, &ActionError{Status: 404, Code: "not_found", Message: "云端没有这份备份"}
	}
	if err := webdav.DeleteFile(client, name, deps); err != nil {
		return false, err
	}
	remaining := []string{}
	for _, entry := range e.uploadedNames() {
		if entry != name {
			remaining = append(remaining, entry)
		}
	}
	e.saveUploadedNames(remaining)
	lowered := make([]webdav.RemoteFile, 0, len(files))
	for _, file := range files {
		if file.Name != name {
			lowered = append(lowered, file)
		}
	}
	e.setRemoteFiles(lowered)
	return true, nil
}

func (e *Engine) remoteFilesSnapshot() []webdav.RemoteFile {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.remoteFiles
}

func (e *Engine) readMarker() *processedMarker {
	raw := e.meta(metaLastProcessed)
	if raw == "" {
		return nil
	}
	parsed, err := wire.DecodeJSON([]byte(raw))
	if err != nil {
		return nil
	}
	record, ok := wire.IsRecord(parsed)
	if !ok {
		return nil
	}
	name, ok := record["name"].(string)
	if !ok {
		return nil
	}
	marker := &processedMarker{Name: name}
	if lastModified, ok := wire.AsInt64(record["lastModified"]); ok {
		marker.LastModified = lastModified
	}
	if etag, ok := record["etag"].(string); ok {
		marker.ETag = &etag
	}
	return marker
}

func (e *Engine) writeMarker(marker processedMarker) {
	value := map[string]any{"name": marker.Name, "lastModified": marker.LastModified}
	if marker.ETag != nil {
		value["etag"] = *marker.ETag
	} else {
		value["etag"] = nil
	}
	out, err := wire.EncodeJSON(value)
	if err != nil {
		return
	}
	e.setMeta(metaLastProcessed, string(out))
}

func (e *Engine) uploadedNames() []string {
	raw := e.meta(metaUploaded)
	if raw == "" {
		return nil
	}
	parsed, err := wire.DecodeJSON([]byte(raw))
	if err != nil {
		return nil
	}
	array, ok := parsed.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(array))
	for _, entry := range array {
		if value, ok := entry.(string); ok {
			out = append(out, value)
		}
	}
	return out
}

func (e *Engine) saveUploadedNames(names []string) {
	out, err := wire.EncodeJSON(names)
	if err != nil {
		return
	}
	e.setMeta(metaUploaded, string(out))
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

func etagPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func webdavError(err error) (*webdav.Error, bool) {
	var target *webdav.Error
	if errors.As(err, &target) {
		return target, true
	}
	return nil, false
}

func backupFormatError(err error) (*backup.BackupFormatError, bool) {
	var target *backup.BackupFormatError
	if errors.As(err, &target) {
		return target, true
	}
	return nil, false
}
