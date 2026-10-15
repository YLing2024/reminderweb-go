package config

import "testing"

func loadEnv(env map[string]string) (*Config, error) {
	return Load(func(key string) string { return env[key] })
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := loadEnv(nil)
	if err != nil {
		t.Fatalf("默认配置加载失败：%v", err)
	}
	if cfg.Host != "127.0.0.1" || cfg.Port != 19240 {
		t.Fatalf("默认监听 = %s:%d，期望 127.0.0.1:19240", cfg.Host, cfg.Port)
	}
	if cfg.AuthMode != AuthBuiltin {
		t.Fatalf("默认认证模式 = %s，期望 builtin", cfg.AuthMode)
	}
	if cfg.DataDir != "./data" {
		t.Fatalf("默认数据目录 = %s", cfg.DataDir)
	}
	if !cfg.ServeStatic || cfg.StaticOnly {
		t.Fatalf("默认托管静态且非纯静态：serveStatic=%v staticOnly=%v", cfg.ServeStatic, cfg.StaticOnly)
	}
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	cases := map[string]map[string]string{
		"端口越界":          {"PORT": "70000"},
		"端口非数字":         {"PORT": "abc"},
		"认证模式非法":        {"AUTH_MODE": "ldap"},
		"日志级别非法":        {"LOG_LEVEL": "verbose"},
		"启用 WebDAV 无地址": {"WEBDAV_ENABLED": "1"},
		"同步间隔越界":        {"WEBDAV_INTERVAL_MINUTES": "0"},
		"允许来源通配":        {"ALLOWED_ORIGINS": "*"},
		"允许来源带路径":       {"ALLOWED_ORIGINS": "https://app.example.com/path"},
		"SameSite 非法":   {"COOKIE_SAMESITE": "strict"},
	}
	for name, env := range cases {
		if _, err := loadEnv(env); err == nil {
			t.Errorf("%s：期望报错但通过了", name)
		}
	}
}

func TestSSORequiresLoopback(t *testing.T) {
	if _, err := loadEnv(map[string]string{"AUTH_MODE": "sso", "HOST": "0.0.0.0"}); err == nil {
		t.Fatal("sso 监听非回环应被拒")
	}
	if _, err := loadEnv(map[string]string{"AUTH_MODE": "sso", "HOST": "127.0.0.1"}); err != nil {
		t.Fatalf("sso 监听回环应通过：%v", err)
	}
}

func TestNoneRejectedInProductionOnNonLoopback(t *testing.T) {
	env := map[string]string{"AUTH_MODE": "none", "HOST": "0.0.0.0", "NODE_ENV": "production"}
	if _, err := loadEnv(env); err == nil {
		t.Fatal("生产环境 none 监听非回环应被拒")
	}
}

func TestParseAllowedOrigins(t *testing.T) {
	origins, err := ParseAllowedOrigins("https://app.example.com, http://127.0.0.1:5173")
	if err != nil {
		t.Fatalf("合法来源解析失败：%v", err)
	}
	if len(origins) != 2 {
		t.Fatalf("来源数 = %d，期望 2", len(origins))
	}
	if _, err := ParseAllowedOrigins("ftp://x"); err == nil {
		t.Fatal("非 http(s) 来源应被拒")
	}
}

func TestIsWeakAuthPassword(t *testing.T) {
	if !IsWeakAuthPassword(&Config{AuthMode: AuthBuiltin, AuthPassword: "changeme"}) {
		t.Fatal("默认口令应判为弱")
	}
	if !IsWeakAuthPassword(&Config{AuthMode: AuthBuiltin, AuthPassword: "short"}) {
		t.Fatal("过短口令应判为弱")
	}
	if IsWeakAuthPassword(&Config{AuthMode: AuthBuiltin, AuthPassword: "a-long-enough-secret"}) {
		t.Fatal("足够长的口令不应判为弱")
	}
	if IsWeakAuthPassword(&Config{AuthMode: AuthSSO, AuthPassword: "changeme"}) {
		t.Fatal("非 builtin 模式不适用弱口令提示")
	}
}
