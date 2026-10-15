// Package syncconfig 实现同步配置的兼容视图（旧 server/src/sync-config.ts）。
//
// 自动同步开关 / 间隔 / 保留份数统一存在 settings 包的库里（与页面上可编辑的 WebDAV 设置同一套键）。
// 本包只保留旧接口的视图形状与校验语义（间隔白名单 5/10/30/60、保留份数 1–50），不再维护第二套存储。
package syncconfig

import (
	"reminderweb-go/internal/config"
	"reminderweb-go/internal/settings"
	"reminderweb-go/internal/store"
	"reminderweb-go/internal/wire"
)

// SyncIntervals 是允许的同步间隔（分钟）。
var SyncIntervals = []int{5, 10, 30, 60}

// 保留份数范围（份）。
const (
	SyncKeepMin = 1
	SyncKeepMax = 50
)

const (
	defaultInterval = 10
	defaultKeep     = 10
)

// StoredSyncConfig 是库中同步配置的三项。
type StoredSyncConfig struct {
	Enabled         bool `json:"enabled"`
	IntervalMinutes int  `json:"intervalMinutes"`
	Keep            int  `json:"keep"`
}

// SyncConfigPatch 是部分更新补丁。
type SyncConfigPatch struct {
	Enabled         *bool
	IntervalMinutes *int
	Keep            *int
}

// SyncConfigView 是同步配置的对外视图。
type SyncConfigView struct {
	Enabled         bool        `json:"enabled"`
	IntervalMinutes int         `json:"intervalMinutes"`
	Keep            int         `json:"keep"`
	Options         SyncOptions `json:"options"`
	// URL 只包含目录地址（不含凭据）；未启用时为空串。
	URL string `json:"url"`
}

// SyncOptions 是可选范围声明。
type SyncOptions struct {
	Intervals []int  `json:"intervals"`
	KeepRange [2]int `json:"keepRange"`
}

// SyncConfigError 表示非法配置；Message 为可直接展示的中文文案。
type SyncConfigError struct{ Message string }

func (e *SyncConfigError) Error() string { return e.Message }

// NormalizeInterval 把任意数值规范到允许的间隔；不在白名单内回落 10。
func NormalizeInterval(value int) int {
	for _, allowed := range SyncIntervals {
		if value == allowed {
			return value
		}
	}
	return defaultInterval
}

// NormalizeKeep 把任意数值规范到 1..50 的整数。
func NormalizeKeep(value int) int {
	if value < SyncKeepMin {
		return SyncKeepMin
	}
	if value > SyncKeepMax {
		return SyncKeepMax
	}
	return value
}

// ReadSyncConfig 读取同步配置（来自统一设置）。
func ReadSyncConfig(db *store.DB, cfg *config.Config) StoredSyncConfig {
	stored := settings.ReadServerSettings(db, cfg)
	return StoredSyncConfig{
		Enabled:         stored.WebdavEnabled,
		IntervalMinutes: stored.WebdavIntervalMinutes,
		Keep:            stored.WebdavKeep,
	}
}

// WriteSyncConfig 写回同步配置（三项一起写，落到统一设置）。
func WriteSyncConfig(db *store.DB, cfg *config.Config, value StoredSyncConfig) error {
	stored := settings.ReadServerSettings(db, cfg)
	stored.WebdavEnabled = value.Enabled
	stored.WebdavIntervalMinutes = value.IntervalMinutes
	stored.WebdavKeep = value.Keep
	return settings.WriteServerSettings(db, stored)
}

// SyncConfigViewFor 构造对外配置视图；url 未启用时为空串。
func SyncConfigViewFor(stored StoredSyncConfig, url string) SyncConfigView {
	viewURL := ""
	if stored.Enabled {
		viewURL = url
	}
	return SyncConfigView{
		Enabled:         stored.Enabled,
		IntervalMinutes: stored.IntervalMinutes,
		Keep:            stored.Keep,
		Options: SyncOptions{
			Intervals: append([]int{}, SyncIntervals...),
			KeepRange: [2]int{SyncKeepMin, SyncKeepMax},
		},
		URL: viewURL,
	}
}

// ParseSyncConfigPatch 解析并校验 PUT 请求体；非法时返回 SyncConfigError（中文文案）。
func ParseSyncConfigPatch(raw any) (SyncConfigPatch, error) {
	record, ok := wire.IsRecord(raw)
	if !ok {
		return SyncConfigPatch{}, &SyncConfigError{Message: "请求内容不正确"}
	}
	patch := SyncConfigPatch{}
	if value, present := record["enabled"]; present {
		b, ok := value.(bool)
		if !ok {
			return patch, &SyncConfigError{Message: "自动同步开关必须是布尔值"}
		}
		patch.Enabled = &b
	}
	if value, present := record["intervalMinutes"]; present {
		n, ok := wire.AsInt64(value)
		allowed := false
		for _, candidate := range SyncIntervals {
			if n == int64(candidate) {
				allowed = true
			}
		}
		if !ok || !allowed {
			return patch, &SyncConfigError{Message: "同步间隔只能选择 5 / 10 / 30 / 60 分钟"}
		}
		i := int(n)
		patch.IntervalMinutes = &i
	}
	if value, present := record["keep"]; present {
		n, ok := wire.AsInt64(value)
		if !ok || n < SyncKeepMin || n > SyncKeepMax {
			return patch, &SyncConfigError{Message: "保留份数必须是 1–50 之间的整数"}
		}
		i := int(n)
		patch.Keep = &i
	}
	if patch.Enabled == nil && patch.IntervalMinutes == nil && patch.Keep == nil {
		return patch, &SyncConfigError{Message: "没有需要更新的配置项"}
	}
	return patch, nil
}

// ApplySyncConfigPatch 合并校验后的补丁并落库，返回新配置。
func ApplySyncConfigPatch(db *store.DB, cfg *config.Config, patch SyncConfigPatch) (StoredSyncConfig, error) {
	current := ReadSyncConfig(db, cfg)
	next := current
	if patch.Enabled != nil {
		next.Enabled = *patch.Enabled
	}
	if patch.IntervalMinutes != nil {
		next.IntervalMinutes = *patch.IntervalMinutes
	}
	if patch.Keep != nil {
		next.Keep = *patch.Keep
	}
	if err := WriteSyncConfig(db, cfg, next); err != nil {
		return StoredSyncConfig{}, err
	}
	return next, nil
}
