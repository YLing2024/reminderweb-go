// Package settings 实现服务器级 WebDAV 设置（旧 server/src/server-settings.ts）。
//
// 服务器模式下，页面上可直接修改 WebDAV 连接与自动同步参数；这些值存在 SQLite 的 meta 表里，
// 对所有设备一致。环境变量退化为「首次默认值」：库里还没有值时用环境变量落库；之后一律以库值为准。
// 优先级：库值 > 环境变量 > 内置默认。口令只进库、绝不回传前端明文。
package settings

import (
	"fmt"
	"net/url"

	"reminderweb-go/internal/config"
	"reminderweb-go/internal/store"
	"reminderweb-go/internal/wire"
)

// 同步间隔与保留份数范围（分钟 / 份）。
const (
	WebdavIntervalMin = 1
	WebdavIntervalMax = 1440
	WebdavKeepMin     = 1
	WebdavKeepMax     = 1000
)

// WebdavPasswordClear 是显式清空口令的哨兵值；字段缺省或空串表示「不修改」。
const WebdavPasswordClear = "__clear__"

// 库键；沿用旧版 sync-config 的三项键，保证既有部署的设置不丢。
const (
	keyRelayAllowPrivate = "relayAllowPrivate"
	keyEnabled           = "syncConfig.enabled"
	keyIntervalMinutes   = "syncConfig.intervalMinutes"
	keyKeep              = "syncConfig.keep"
	keyURL               = "webdav.url"
	keyUsername          = "webdav.username"
	keyPassword          = "webdav.password"
)

// ServerSettings 是服务器级设置的内部形状（含口令明文，只在服务端内存 / 库中出现）。
type ServerSettings struct {
	RelayAllowPrivate     bool
	WebdavEnabled         bool
	WebdavURL             string
	WebdavUsername        string
	WebdavPassword        string
	WebdavIntervalMinutes int
	WebdavKeep            int
}

// ServerSettingsView 是对外视图：绝不包含口令明文。
type ServerSettingsView struct {
	RelayAllowPrivate     bool   `json:"relayAllowPrivate"`
	WebdavEnabled         bool   `json:"webdavEnabled"`
	WebdavURL             string `json:"webdavUrl"`
	WebdavUsername        string `json:"webdavUsername"`
	WebdavPasswordSet     bool   `json:"webdavPasswordSet"`
	WebdavIntervalMinutes int    `json:"webdavIntervalMinutes"`
	WebdavKeep            int    `json:"webdavKeep"`
}

// WebdavConfigPatch 是部分更新补丁；未出现的字段不改动。
type WebdavConfigPatch struct {
	RelayAllowPrivate     *bool
	WebdavEnabled         *bool
	WebdavURL             *string
	WebdavUsername        *string
	WebdavPassword        *string
	WebdavIntervalMinutes *int
	WebdavKeep            *int
}

// WebdavConfigUpdateResult 是补丁应用结果。
type WebdavConfigUpdateResult struct {
	Settings ServerSettings
	// Changed 是变了的字段名（不含口令值），用于审计。
	Changed         []string
	PasswordChanged bool
}

// ServerSettingError 表示非法设置；Message 为可直接展示的中文文案。
type ServerSettingError struct{ Message string }

func (e *ServerSettingError) Error() string { return e.Message }

func envDefaults(cfg *config.Config) ServerSettings {
	return ServerSettings{
		RelayAllowPrivate:     cfg.RelayAllowPrivate,
		WebdavEnabled:         cfg.WebDAVEnabled,
		WebdavURL:             cfg.WebDAVURL,
		WebdavUsername:        cfg.WebDAVUsername,
		WebdavPassword:        cfg.WebDAVPassword,
		WebdavIntervalMinutes: cfg.WebDAVIntervalMinutes,
		WebdavKeep:            cfg.WebDAVKeep,
	}
}

func readBool(db *store.DB, key string, fallback bool) bool {
	raw, ok, err := db.Meta(key)
	if err != nil || !ok {
		_ = db.SetMeta(key, boolSetting(fallback))
		return fallback
	}
	return raw == "1"
}

func boolSetting(v bool) string {
	if v {
		return "1"
	}
	return "0"
}

func readInt(db *store.DB, key string, fallback, min, max int) int {
	raw, ok, err := db.Meta(key)
	value := -1
	if err == nil && ok {
		value = parseInt(raw)
	}
	if err != nil || !ok || value < min || value > max {
		_ = db.SetMeta(key, fmt.Sprintf("%d", fallback))
		return fallback
	}
	return value
}

func parseInt(raw string) int {
	out := 0
	negative := false
	for i, ch := range raw {
		if i == 0 && ch == '-' {
			negative = true
			continue
		}
		if ch < '0' || ch > '9' {
			return -1
		}
		out = out*10 + int(ch-'0')
	}
	if negative {
		return -out
	}
	return out
}

func readString(db *store.DB, key, fallback string) string {
	raw, ok, err := db.Meta(key)
	if err != nil || !ok {
		_ = db.SetMeta(key, fallback)
		return fallback
	}
	return raw
}

// ReadServerSettings 读取整套设置；库里缺某字段时按环境变量（内置默认）落库后返回。
func ReadServerSettings(db *store.DB, cfg *config.Config) ServerSettings {
	defaults := envDefaults(cfg)
	return ServerSettings{
		RelayAllowPrivate:     readBool(db, keyRelayAllowPrivate, defaults.RelayAllowPrivate),
		WebdavEnabled:         readBool(db, keyEnabled, defaults.WebdavEnabled),
		WebdavURL:             readString(db, keyURL, defaults.WebdavURL),
		WebdavUsername:        readString(db, keyUsername, defaults.WebdavUsername),
		WebdavPassword:        readString(db, keyPassword, defaults.WebdavPassword),
		WebdavIntervalMinutes: readInt(db, keyIntervalMinutes, defaults.WebdavIntervalMinutes, WebdavIntervalMin, WebdavIntervalMax),
		WebdavKeep:            readInt(db, keyKeep, defaults.WebdavKeep, WebdavKeepMin, WebdavKeepMax),
	}
}

// WriteServerSettings 整套落库（不校验；调用方先走 ApplyWebdavConfigPatch 或受信路径）。
func WriteServerSettings(db *store.DB, value ServerSettings) error {
	values := map[string]string{
		keyRelayAllowPrivate: boolSetting(value.RelayAllowPrivate),
		keyEnabled:           boolSetting(value.WebdavEnabled),
		keyURL:               value.WebdavURL,
		keyUsername:          value.WebdavUsername,
		keyPassword:          value.WebdavPassword,
		keyIntervalMinutes:   fmt.Sprintf("%d", value.WebdavIntervalMinutes),
		keyKeep:              fmt.Sprintf("%d", value.WebdavKeep),
	}
	for key, raw := range values {
		if err := db.SetMeta(key, raw); err != nil {
			return err
		}
	}
	return nil
}

// ToView 生成对外视图（口令只给布尔）。
func ToView(value ServerSettings) ServerSettingsView {
	return ServerSettingsView{
		RelayAllowPrivate:     value.RelayAllowPrivate,
		WebdavEnabled:         value.WebdavEnabled,
		WebdavURL:             value.WebdavURL,
		WebdavUsername:        value.WebdavUsername,
		WebdavPasswordSet:     value.WebdavPassword != "",
		WebdavIntervalMinutes: value.WebdavIntervalMinutes,
		WebdavKeep:            value.WebdavKeep,
	}
}

func validateURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "服务器地址格式不正确（需形如 https://dav.example.com/dav/）"
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "服务器地址需以 http:// 或 https:// 开头"
	}
	return ""
}

// ParseWebdavConfigPatch 解析并校验 PUT 请求体；非法时返回 ServerSettingError（中文文案）。
func ParseWebdavConfigPatch(raw any) (WebdavConfigPatch, error) {
	record, ok := wire.IsRecord(raw)
	if !ok {
		return WebdavConfigPatch{}, &ServerSettingError{Message: "请求内容不正确"}
	}
	patch := WebdavConfigPatch{}
	if value, present := record["relayAllowPrivate"]; present {
		b, ok := value.(bool)
		if !ok {
			return patch, &ServerSettingError{Message: "「允许转发到内网地址」必须是布尔值"}
		}
		patch.RelayAllowPrivate = &b
	}
	if value, present := record["webdavEnabled"]; present {
		b, ok := value.(bool)
		if !ok {
			return patch, &ServerSettingError{Message: "「自动同步」必须是布尔值"}
		}
		patch.WebdavEnabled = &b
	}
	if value, present := record["webdavUrl"]; present {
		s, ok := value.(string)
		if !ok {
			return patch, &ServerSettingError{Message: "「服务器地址」必须是文本"}
		}
		patch.WebdavURL = &s
	}
	if value, present := record["webdavUsername"]; present {
		s, ok := value.(string)
		if !ok {
			return patch, &ServerSettingError{Message: "「用户名」必须是文本"}
		}
		patch.WebdavUsername = &s
	}
	if value, present := record["webdavPassword"]; present {
		s, ok := value.(string)
		if !ok {
			return patch, &ServerSettingError{Message: "「口令」必须是文本"}
		}
		patch.WebdavPassword = &s
	}
	if value, present := record["webdavIntervalMinutes"]; present {
		n, ok := wire.AsInt64(value)
		if !ok || n < WebdavIntervalMin || n > WebdavIntervalMax {
			return patch, &ServerSettingError{Message: fmt.Sprintf("同步间隔必须是 %d–%d 之间的整数", WebdavIntervalMin, WebdavIntervalMax)}
		}
		i := int(n)
		patch.WebdavIntervalMinutes = &i
	}
	if value, present := record["webdavKeep"]; present {
		n, ok := wire.AsInt64(value)
		if !ok || n < WebdavKeepMin || n > WebdavKeepMax {
			return patch, &ServerSettingError{Message: fmt.Sprintf("保留份数必须是 %d–%d 之间的整数", WebdavKeepMin, WebdavKeepMax)}
		}
		i := int(n)
		patch.WebdavKeep = &i
	}
	if patch.RelayAllowPrivate == nil && patch.WebdavEnabled == nil && patch.WebdavURL == nil &&
		patch.WebdavUsername == nil && patch.WebdavPassword == nil && patch.WebdavIntervalMinutes == nil &&
		patch.WebdavKeep == nil {
		return patch, &ServerSettingError{Message: "没有需要更新的配置项"}
	}
	return patch, nil
}

// ApplyWebdavConfigPatch 合并校验后的补丁并落库；返回新设置与「哪些字段变了」。
// 口令：缺省 / 空串 = 不改动；WebdavPasswordClear = 清空。返回值绝不含口令明文。
func ApplyWebdavConfigPatch(db *store.DB, cfg *config.Config, patch WebdavConfigPatch) (WebdavConfigUpdateResult, error) {
	current := ReadServerSettings(db, cfg)
	next := current
	changed := []string{}

	if patch.RelayAllowPrivate != nil && *patch.RelayAllowPrivate != current.RelayAllowPrivate {
		next.RelayAllowPrivate = *patch.RelayAllowPrivate
		changed = append(changed, "relayAllowPrivate")
	}
	if patch.WebdavEnabled != nil && *patch.WebdavEnabled != current.WebdavEnabled {
		next.WebdavEnabled = *patch.WebdavEnabled
		changed = append(changed, "webdavEnabled")
	}
	if patch.WebdavURL != nil && *patch.WebdavURL != current.WebdavURL {
		next.WebdavURL = *patch.WebdavURL
		changed = append(changed, "webdavUrl")
	}
	if patch.WebdavUsername != nil && *patch.WebdavUsername != current.WebdavUsername {
		next.WebdavUsername = *patch.WebdavUsername
		changed = append(changed, "webdavUsername")
	}
	if patch.WebdavIntervalMinutes != nil && *patch.WebdavIntervalMinutes != current.WebdavIntervalMinutes {
		next.WebdavIntervalMinutes = *patch.WebdavIntervalMinutes
		changed = append(changed, "webdavIntervalMinutes")
	}
	if patch.WebdavKeep != nil && *patch.WebdavKeep != current.WebdavKeep {
		next.WebdavKeep = *patch.WebdavKeep
		changed = append(changed, "webdavKeep")
	}

	passwordChanged := false
	if patch.WebdavPassword != nil && *patch.WebdavPassword != "" {
		nextPassword := *patch.WebdavPassword
		if nextPassword == WebdavPasswordClear {
			nextPassword = ""
		}
		passwordChanged = nextPassword != current.WebdavPassword
		next.WebdavPassword = nextPassword
		if passwordChanged {
			changed = append(changed, "webdavPassword")
		}
	}

	if next.WebdavEnabled && next.WebdavURL == "" {
		return WebdavConfigUpdateResult{}, &ServerSettingError{Message: "启用自动同步前请先填写服务器地址"}
	}
	if next.WebdavURL != "" {
		if message := validateURL(next.WebdavURL); message != "" {
			return WebdavConfigUpdateResult{}, &ServerSettingError{Message: message}
		}
	}
	if err := WriteServerSettings(db, next); err != nil {
		return WebdavConfigUpdateResult{}, err
	}
	return WebdavConfigUpdateResult{Settings: next, Changed: changed, PasswordChanged: passwordChanged}, nil
}
