// Package config 负责 reminderweb-go 的环境变量（+ 可选 YAML）配置加载与严格校验。
//
// 口径与旧 Node 实现 server/src/config.ts 逐项对齐：非法值直接报错并退出，绝不在日志中
// 打印 AUTH_PASSWORD 等敏感值；`sso` 只允许监听回环，`none` 仅限本机开发。
package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// AuthMode 管理面认证模式。
type AuthMode string

const (
	// AuthBuiltin 自带口令 + 登录页 + 会话 Cookie（默认）。
	AuthBuiltin AuthMode = "builtin"
	// AuthSSO 只信任前置 Auth Gateway 注入的 X-Auth-User，自带登录入口 404。
	AuthSSO AuthMode = "sso"
	// AuthNone 本机开发，所有请求视为 dev 用户。
	AuthNone AuthMode = "none"
)

// CookieSameSite 会话 Cookie 的 SameSite 策略；`none` 用于前后端分离的跨站部署。
type CookieSameSite string

const (
	// SameSiteLax 同源部署默认值。
	SameSiteLax CookieSameSite = "lax"
	// SameSiteNone 跨站部署（必须配合 Secure）。
	SameSiteNone CookieSameSite = "none"
)

// LogLevel 日志级别。
type LogLevel string

// Config 运行时配置快照。
type Config struct {
	Host    string
	Port    int
	DataDir string
	// StaticDir 后端直接服务的静态产物目录；嵌入式部署下仅作兼容占位。
	StaticDir string

	AuthMode       AuthMode
	AuthUser       string
	AuthPassword   string
	SessionTTLDays int
	LoginRateLimit int
	TrustProxy     bool

	ServeStatic bool
	// StaticOnly 纯静态形态：只托管前端产物，不启用任何 /api 路由。
	StaticOnly bool
	LogLevel   LogLevel
	NodeEnv    string

	WebDAVEnabled         bool
	WebDAVURL             string
	WebDAVUsername        string
	WebDAVPassword        string
	WebDAVIntervalMinutes int
	WebDAVDebounceSeconds int
	WebDAVEncrypt         bool
	WebDAVKeep            int
	WebDAVTimeoutSeconds  int

	AllowedOrigins []string
	CookieSameSite CookieSameSite
	// RelayAllowPrivate 客户端模式下 WebDAV 转发放行内网地址的首次默认值。
	RelayAllowPrivate bool
}

// ConfigError 配置错误，Message 可直接展示给运维。
type ConfigError struct{ Message string }

func (e *ConfigError) Error() string { return e.Message }

// yamlConfig 是可选 YAML 配置文件的形态；字段留空时回落到同名的环境变量。
type yamlConfig struct {
	Host                  string   `yaml:"host"`
	Port                  *int     `yaml:"port"`
	DataDir               string   `yaml:"data_dir"`
	AuthMode              string   `yaml:"auth_mode"`
	AuthUser              string   `yaml:"auth_user"`
	AuthPassword          string   `yaml:"auth_password"`
	SessionTTLDays        *int     `yaml:"session_ttl_days"`
	LoginRateLimit        *int     `yaml:"login_rate_limit"`
	TrustProxy            *bool    `yaml:"trust_proxy"`
	ServeStatic           *bool    `yaml:"serve_static"`
	StaticOnly            *bool    `yaml:"static_only"`
	LogLevel              string   `yaml:"log_level"`
	WebDAVEnabled         *bool    `yaml:"webdav_enabled"`
	WebDAVURL             string   `yaml:"webdav_url"`
	WebDAVUsername        string   `yaml:"webdav_username"`
	WebDAVPassword        string   `yaml:"webdav_password"`
	WebDAVIntervalMinutes *int     `yaml:"webdav_interval_minutes"`
	WebDAVDebounceSeconds *int     `yaml:"webdav_debounce_seconds"`
	WebDAVEncrypt         *bool    `yaml:"webdav_encrypt"`
	WebDAVKeep            *int     `yaml:"webdav_keep"`
	WebDAVTimeoutSeconds  *int     `yaml:"webdav_timeout_seconds"`
	AllowedOrigins        []string `yaml:"allowed_origins"`
	CookieSameSite        string   `yaml:"cookie_same_site"`
	RelayAllowPrivate     *bool    `yaml:"webdav_relay_allow_private"`
}

// Load 从环境变量（以及 CONFIG_FILE 指定的可选 YAML）解析配置。
// 优先级：环境变量 > YAML > 内置默认。
func Load(get func(string) string) (*Config, error) {
	yamlValues, err := loadYAML(get)
	if err != nil {
		return nil, err
	}
	// effective(name) 先看 YAML，再由环境变量覆盖：两者都为「未设置」时返回空串。
	pick := func(name string, yamlValue string) string {
		if v := strings.TrimSpace(get(name)); v != "" {
			return v
		}
		return yamlValue
	}

	host := pick("HOST", yamlValues.Host)
	if host == "" {
		host = "127.0.0.1"
	}
	port, err := pickInt(pick("PORT", intPtrString(yamlValues.Port)), "PORT", 19240, 1, 65535)
	if err != nil {
		return nil, err
	}

	rawAuthMode := pick("AUTH_MODE", yamlValues.AuthMode)
	if rawAuthMode == "" {
		rawAuthMode = string(AuthBuiltin)
	}
	if rawAuthMode != "builtin" && rawAuthMode != "sso" && rawAuthMode != "none" {
		return nil, &ConfigError{Message: fmt.Sprintf("环境变量 AUTH_MODE 只能是 builtin / sso / none，当前为「%s」", rawAuthMode)}
	}
	authMode := AuthMode(rawAuthMode)

	rawLogLevel := pick("LOG_LEVEL", yamlValues.LogLevel)
	if rawLogLevel == "" {
		rawLogLevel = "info"
	}
	switch rawLogLevel {
	case "debug", "info", "warn", "error":
	default:
		return nil, &ConfigError{Message: fmt.Sprintf("环境变量 LOG_LEVEL 只能是 debug / info / warn / error，当前为「%s」", rawLogLevel)}
	}

	nodeEnv := pick("NODE_ENV", "")
	if nodeEnv == "" {
		nodeEnv = "development"
	}

	if authMode == AuthSSO && !isLoopbackHost(host) {
		return nil, &ConfigError{Message: "AUTH_MODE=sso 时 HOST 必须是回环地址（127.0.0.1 / ::1 / localhost）：SSO 模式只应监听回环，由网关转发并注入 X-Auth-User，否则可被伪造头绕过认证。"}
	}
	if authMode == AuthNone && !isLoopbackHost(host) && nodeEnv == "production" {
		return nil, &ConfigError{Message: "AUTH_MODE=none 仅用于本机开发，生产环境（NODE_ENV=production）且监听非回环地址时拒绝启动。"}
	}

	webdavEnabled, err := pickBool(pick("WEBDAV_ENABLED", boolPtrString(yamlValues.WebDAVEnabled)), "WEBDAV_ENABLED", false)
	if err != nil {
		return nil, err
	}
	webdavURL := strings.TrimSpace(pick("WEBDAV_URL", yamlValues.WebDAVURL))
	if webdavEnabled && webdavURL == "" {
		return nil, &ConfigError{Message: "WEBDAV_ENABLED=1 时必须设置 WEBDAV_URL（WebDAV 目录地址）。"}
	}
	webdavInterval, err := pickInt(pick("WEBDAV_INTERVAL_MINUTES", intPtrString(yamlValues.WebDAVIntervalMinutes)), "WEBDAV_INTERVAL_MINUTES", 10, 1, 1440)
	if err != nil {
		return nil, err
	}
	webdavDebounce, err := pickInt(pick("WEBDAV_DEBOUNCE_SECONDS", intPtrString(yamlValues.WebDAVDebounceSeconds)), "WEBDAV_DEBOUNCE_SECONDS", 60, 0, 86400)
	if err != nil {
		return nil, err
	}
	webdavEncrypt, err := pickBool(pick("WEBDAV_ENCRYPT", boolPtrString(yamlValues.WebDAVEncrypt)), "WEBDAV_ENCRYPT", true)
	if err != nil {
		return nil, err
	}
	webdavKeep, err := pickInt(pick("WEBDAV_KEEP", intPtrString(yamlValues.WebDAVKeep)), "WEBDAV_KEEP", 10, 1, 1000)
	if err != nil {
		return nil, err
	}
	webdavTimeout, err := pickInt(pick("WEBDAV_TIMEOUT_SECONDS", intPtrString(yamlValues.WebDAVTimeoutSeconds)), "WEBDAV_TIMEOUT_SECONDS", 20, 1, 600)
	if err != nil {
		return nil, err
	}

	rawOrigins := pick("ALLOWED_ORIGINS", strings.Join(yamlValues.AllowedOrigins, ","))
	allowedOrigins, err := parseAllowedOrigins(rawOrigins)
	if err != nil {
		return nil, err
	}
	cookieSameSite, err := parseCookieSameSite(pick("COOKIE_SAMESITE", yamlValues.CookieSameSite))
	if err != nil {
		return nil, err
	}

	sessionTTL, err := pickInt(pick("SESSION_TTL_DAYS", intPtrString(yamlValues.SessionTTLDays)), "SESSION_TTL_DAYS", 30, 1, 3650)
	if err != nil {
		return nil, err
	}
	loginRate, err := pickInt(pick("LOGIN_RATE_LIMIT", intPtrString(yamlValues.LoginRateLimit)), "LOGIN_RATE_LIMIT", 5, 1, 1000)
	if err != nil {
		return nil, err
	}
	trustProxy, err := pickBool(pick("TRUST_PROXY", boolPtrString(yamlValues.TrustProxy)), "TRUST_PROXY", true)
	if err != nil {
		return nil, err
	}
	serveStatic, err := pickBool(pick("SERVE_STATIC", boolPtrString(yamlValues.ServeStatic)), "SERVE_STATIC", true)
	if err != nil {
		return nil, err
	}
	staticOnly, err := pickBool(pick("STATIC_ONLY", boolPtrString(yamlValues.StaticOnly)), "STATIC_ONLY", false)
	if err != nil {
		return nil, err
	}
	relayAllowPrivate, err := pickBool(pick("WEBDAV_RELAY_ALLOW_PRIVATE", boolPtrString(yamlValues.RelayAllowPrivate)), "WEBDAV_RELAY_ALLOW_PRIVATE", false)
	if err != nil {
		return nil, err
	}

	dataDir := pick("DATA_DIR", yamlValues.DataDir)
	if dataDir == "" {
		dataDir = "./data"
	}
	authUser := pick("AUTH_USER", yamlValues.AuthUser)
	if authUser == "" {
		authUser = "admin"
	}
	authPassword := pick("AUTH_PASSWORD", yamlValues.AuthPassword)

	cwd, _ := os.Getwd()
	return &Config{
		Host:                  host,
		Port:                  port,
		DataDir:               dataDir,
		StaticDir:             filepath.Join(cwd, "dist"),
		AuthMode:              authMode,
		AuthUser:              authUser,
		AuthPassword:          authPassword,
		SessionTTLDays:        sessionTTL,
		LoginRateLimit:        loginRate,
		TrustProxy:            trustProxy,
		ServeStatic:           serveStatic,
		StaticOnly:            staticOnly,
		LogLevel:              LogLevel(rawLogLevel),
		NodeEnv:               nodeEnv,
		WebDAVEnabled:         webdavEnabled,
		WebDAVURL:             webdavURL,
		WebDAVUsername:        pick("WEBDAV_USERNAME", yamlValues.WebDAVUsername),
		WebDAVPassword:        pick("WEBDAV_PASSWORD", yamlValues.WebDAVPassword),
		WebDAVIntervalMinutes: webdavInterval,
		WebDAVDebounceSeconds: webdavDebounce,
		WebDAVEncrypt:         webdavEncrypt,
		WebDAVKeep:            webdavKeep,
		WebDAVTimeoutSeconds:  webdavTimeout,
		AllowedOrigins:        allowedOrigins,
		CookieSameSite:        cookieSameSite,
		RelayAllowPrivate:     relayAllowPrivate,
	}, nil
}

// loadYAML 读取可选 YAML：CONFIG_FILE 显式指定，否则尝试当前目录的 config.yml；
// 两者都不存在时返回零值（只靠环境变量）。
func loadYAML(get func(string) string) (yamlConfig, error) {
	path := strings.TrimSpace(get("CONFIG_FILE"))
	if path == "" {
		if _, err := os.Stat("config.yml"); err == nil {
			path = "config.yml"
		}
	}
	var out yamlConfig
	if path == "" {
		return out, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return out, &ConfigError{Message: fmt.Sprintf("配置文件 %s 无法读取：%v", path, err)}
	}
	if err := yaml.Unmarshal(data, &out); err != nil {
		return out, &ConfigError{Message: fmt.Sprintf("配置文件 %s 解析失败：%v", path, err)}
	}
	return out, nil
}

func intPtrString(v *int) string {
	if v == nil {
		return ""
	}
	return strconv.Itoa(*v)
}

func boolPtrString(v *bool) string {
	if v == nil {
		return ""
	}
	if *v {
		return "1"
	}
	return "0"
}

func pickInt(raw, name string, fallback, min, max int) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value < min || value > max {
		return 0, &ConfigError{Message: fmt.Sprintf("环境变量 %s 必须是 %d–%d 之间的整数，当前为「%s」", name, min, max, raw)}
	}
	return value, nil
}

func pickBool(raw, name string, fallback bool) (bool, error) {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" {
		return fallback, nil
	}
	switch trimmed {
	case "1", "true", "yes", "on":
		return true, nil
	case "0", "false", "no", "off":
		return false, nil
	}
	return false, &ConfigError{Message: fmt.Sprintf("环境变量 %s 必须是布尔值（1/0、true/false），当前为「%s」", name, raw)}
}

// IsLoopbackHost 判断是否为本机回环地址（IPv4 / IPv6 / localhost）。
func IsLoopbackHost(host string) bool { return isLoopbackHost(host) }

func isLoopbackHost(host string) bool {
	value := strings.ToLower(strings.TrimSpace(host))
	if value == "localhost" || value == "::1" || value == "127.0.0.1" {
		return true
	}
	return strings.HasPrefix(value, "127.")
}

// ParseAllowedOrigins 解析逗号分隔的精确来源白名单；拒绝 `*` 与带路径的非法值。
// 返回规范化后的 origin（去重、保序）。
func ParseAllowedOrigins(raw string) ([]string, error) { return parseAllowedOrigins(raw) }

func parseAllowedOrigins(raw string) ([]string, error) {
	out := []string{}
	if strings.TrimSpace(raw) == "" {
		return out, nil
	}
	seen := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		entry := strings.TrimSpace(part)
		if entry == "" {
			continue
		}
		if entry == "*" {
			return nil, &ConfigError{Message: "环境变量 ALLOWED_ORIGINS 不能使用 * 通配（跨域携带 Cookie 时必须列出精确来源）。"}
		}
		u, err := url.Parse(entry)
		if err != nil || u.Scheme == "" || u.Host == "" {
			return nil, &ConfigError{Message: fmt.Sprintf("环境变量 ALLOWED_ORIGINS 的「%s」不是合法来源（需形如 https://app.example.com）。", entry)}
		}
		if u.Scheme != "http" && u.Scheme != "https" {
			return nil, &ConfigError{Message: fmt.Sprintf("环境变量 ALLOWED_ORIGINS 的「%s」只支持 http/https 来源。", entry)}
		}
		if u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return nil, &ConfigError{Message: fmt.Sprintf("环境变量 ALLOWED_ORIGINS 的「%s」只能是来源（scheme://host[:port]），不能带路径或查询）。", entry)}
		}
		origin := u.Scheme + "://" + u.Host
		if !seen[origin] {
			seen[origin] = true
			out = append(out, origin)
		}
	}
	return out, nil
}

func parseCookieSameSite(raw string) (CookieSameSite, error) {
	if strings.TrimSpace(raw) == "" {
		return SameSiteLax, nil
	}
	value := strings.ToLower(strings.TrimSpace(raw))
	if value != "lax" && value != "none" {
		return "", &ConfigError{Message: fmt.Sprintf("环境变量 COOKIE_SAMESITE 只能是 lax / none，当前为「%s」", raw)}
	}
	return CookieSameSite(value), nil
}

// IsWeakAuthPassword 判断是否为需要提醒的默认 / 弱口令（builtin 且仍是 changeme 或长度 < 8）。
// 口令留空（首次启动会生成一次性随机口令）不算弱口令。
func IsWeakAuthPassword(cfg *Config) bool {
	if cfg.AuthMode != AuthBuiltin {
		return false
	}
	if cfg.AuthPassword == "" {
		return false
	}
	return cfg.AuthPassword == "changeme" || len(cfg.AuthPassword) < 8
}

// Describe 生成启动摘要（不含任何敏感值）。
func (c *Config) Describe() string {
	staticDesc := "关闭"
	if c.ServeStatic {
		staticDesc = c.StaticDir
	}
	if c.StaticOnly {
		staticDesc = "纯静态"
	}
	webdavDesc := "关闭"
	if c.WebDAVEnabled {
		webdavDesc = "同步到 " + c.WebDAVURL
	}
	corsDesc := "关闭"
	if len(c.AllowedOrigins) > 0 {
		corsDesc = strings.Join(c.AllowedOrigins, ",")
	}
	relayDesc := "关闭"
	if c.RelayAllowPrivate {
		relayDesc = "允许"
	}
	return strings.Join([]string{
		fmt.Sprintf("监听 http://%s:%d", c.Host, c.Port),
		"认证模式 " + string(c.AuthMode),
		"数据目录 " + c.DataDir,
		"静态文件 " + staticDesc,
		"WebDAV " + webdavDesc,
		"CORS " + corsDesc,
		"内网转发 " + relayDesc,
	}, " | ")
}
