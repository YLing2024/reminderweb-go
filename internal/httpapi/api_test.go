package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"reminderweb-go/internal/auth"
	"reminderweb-go/internal/config"
	"reminderweb-go/internal/store"
	"reminderweb-go/internal/store/storetest"
)

// testServer 用真实路由挂一个独占 MySQL 测试库的 Server；static 为可选的嵌入产物替身。
func testServer(t *testing.T, env map[string]string, static fstest.MapFS) (*Server, *store.DB) {
	t.Helper()
	cfg, err := config.Load(func(key string) string { return env[key] })
	if err != nil {
		t.Fatalf("加载测试配置失败：%v", err)
	}
	db := storetest.Open(t)

	options := Options{
		Config:      cfg,
		DB:          db,
		RateLimiter: auth.NewRateLimiter(cfg.LoginRateLimit, auth.LoginWindowMS, nil),
		Logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:         func() int64 { return 1_700_000_000_000 },
	}
	if static != nil {
		options.StaticFS = static
	}
	return New(options), db
}

func do(t *testing.T, handler http.Handler, method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, reader)
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("响应不是 JSON：%q（%v）", rec.Body.String(), err)
	}
	return out
}

func TestPublicHealthAndVersion(t *testing.T) {
	server, _ := testServer(t, map[string]string{"AUTH_MODE": "none"}, nil)
	handler := server.Handler()

	rec := do(t, handler, http.MethodGet, "/api/health", "", nil)
	if rec.Code != 200 {
		t.Fatalf("health 状态码 = %d", rec.Code)
	}
	if body := decode(t, rec); body["ok"] != true || body["authMode"] != "none" {
		t.Fatalf("health 响应错误：%+v", body)
	}

	rec = do(t, handler, http.MethodGet, "/api/version", "", nil)
	if rec.Code != 200 {
		t.Fatalf("version 状态码 = %d", rec.Code)
	}
	if body := decode(t, rec); body["server"] != ServerName || body["schemaVersion"] == nil {
		t.Fatalf("version 响应错误：%+v", body)
	}
}

func TestUnknownAPIRouteReturns404(t *testing.T) {
	server, _ := testServer(t, map[string]string{"AUTH_MODE": "none"}, nil)
	rec := do(t, server.Handler(), http.MethodGet, "/api/nope", "", nil)
	if rec.Code != 404 {
		t.Fatalf("未命中路由状态码 = %d，期望 404", rec.Code)
	}
	if code := decode(t, rec)["error"]; code != "not_found" {
		t.Fatalf("错误码 = %v，期望 not_found", code)
	}
}

func TestBuiltinAuthFlow(t *testing.T) {
	server, db := testServer(t, map[string]string{"AUTH_MODE": "builtin"}, nil)
	handler := server.Handler()

	if _, err := auth.EnsureInitialUser(db, "admin", "example-password", 1); err != nil {
		t.Fatalf("建立初始用户失败：%v", err)
	}

	// 未认证 → 401。
	rec := do(t, handler, http.MethodGet, "/api/data", "", nil)
	if rec.Code != 401 || decode(t, rec)["error"] != "unauthorized" {
		t.Fatalf("未认证响应错误：%d %s", rec.Code, rec.Body.String())
	}

	// 错误口令 → 401。
	wrong := do(t, handler, http.MethodPost, "/api/auth/login", `{"username":"admin","password":"nope"}`, map[string]string{"Content-Type": "application/json"})
	if wrong.Code != 401 || decode(t, wrong)["error"] != "invalid_credentials" {
		t.Fatalf("错误口令响应错误：%d %s", wrong.Code, wrong.Body.String())
	}

	// 正确登录 → 200 + 会话 Cookie。
	login := do(t, handler, http.MethodPost, "/api/auth/login", `{"username":"admin","password":"example-password"}`, map[string]string{"Content-Type": "application/json"})
	if login.Code != 200 {
		t.Fatalf("登录状态码 = %d：%s", login.Code, login.Body.String())
	}
	cookie := login.Header().Get("Set-Cookie")
	if !strings.Contains(cookie, auth.SessionCookie+"=") || !strings.Contains(cookie, "HttpOnly") {
		t.Fatalf("会话 Cookie 形态错误：%q", cookie)
	}
	session := strings.SplitN(cookie, ";", 2)[0]

	// 带会话访问 /api/auth/me。
	me := do(t, handler, http.MethodGet, "/api/auth/me", "", map[string]string{"Cookie": session})
	if me.Code != 200 || decode(t, me)["username"] != "admin" {
		t.Fatalf("me 响应错误：%d %s", me.Code, me.Body.String())
	}

	// 登出后会话失效。
	out := do(t, handler, http.MethodPost, "/api/auth/logout", "", map[string]string{"Cookie": session})
	if out.Code != 200 {
		t.Fatalf("登出状态码 = %d", out.Code)
	}
	after := do(t, handler, http.MethodGet, "/api/auth/me", "", map[string]string{"Cookie": session})
	if after.Code != 401 {
		t.Fatalf("登出后仍可用：%d", after.Code)
	}
}

func TestLoginNotAvailableOutsideBuiltin(t *testing.T) {
	server, _ := testServer(t, map[string]string{"AUTH_MODE": "none"}, nil)
	rec := do(t, server.Handler(), http.MethodPost, "/api/auth/login", `{"username":"a","password":"b"}`, map[string]string{"Content-Type": "application/json"})
	if rec.Code != 400 || decode(t, rec)["error"] != "login_not_available" {
		t.Fatalf("非 builtin 登录响应错误：%d %s", rec.Code, rec.Body.String())
	}
}

func TestPutAndGetData(t *testing.T) {
	server, _ := testServer(t, map[string]string{"AUTH_MODE": "none"}, nil)
	handler := server.Handler()

	put := do(t, handler, http.MethodPut, "/api/data",
		`{"baseRevision":0,"reminders":[{"id":1,"title":"纪念日","date":"2026-01-01","type":"ANNUAL","updatedAt":10}],"tags":[],"tombstones":[]}`,
		map[string]string{"Content-Type": "application/json"})
	if put.Code != 200 {
		t.Fatalf("PUT /api/data 状态码 = %d：%s", put.Code, put.Body.String())
	}
	if body := decode(t, put); body["revision"] != float64(1) || body["rejected"] != float64(0) {
		t.Fatalf("PUT 响应错误：%+v", body)
	}

	get := do(t, handler, http.MethodGet, "/api/data", "", nil)
	if get.Code != 200 {
		t.Fatalf("GET /api/data 状态码 = %d", get.Code)
	}
	body := decode(t, get)
	reminders, ok := body["reminders"].([]any)
	if !ok || len(reminders) != 1 {
		t.Fatalf("读回的提醒错误：%+v", body["reminders"])
	}
	if _, ok := body["imageNames"].([]any); !ok {
		t.Fatalf("imageNames 必须是数组：%v", body["imageNames"])
	}
}

func TestReplaceRequiresReminders(t *testing.T) {
	server, _ := testServer(t, map[string]string{"AUTH_MODE": "none"}, nil)
	rec := do(t, server.Handler(), http.MethodPut, "/api/data/replace", `{}`, map[string]string{"Content-Type": "application/json"})
	if rec.Code != 400 || decode(t, rec)["error"] != "invalid_request" {
		t.Fatalf("缺 reminders 响应错误：%d %s", rec.Code, rec.Body.String())
	}
}

func TestBodyTooLarge(t *testing.T) {
	server, _ := testServer(t, map[string]string{"AUTH_MODE": "none"}, nil)
	big := `{"data":"` + strings.Repeat("a", MaxBodyBytes+10) + `"}`
	rec := do(t, server.Handler(), http.MethodPut, "/api/data", big, map[string]string{"Content-Type": "application/json"})
	if rec.Code != 413 || decode(t, rec)["error"] != "payload_too_large" {
		t.Fatalf("超大请求体响应错误：%d", rec.Code)
	}
}

func TestStaticServingAndFallback(t *testing.T) {
	static := fstest.MapFS{
		"index.html":      &fstest.MapFile{Data: []byte("<html>app</html>")},
		"assets/index.js": &fstest.MapFile{Data: []byte("console.log(1)")},
	}
	server, _ := testServer(t, map[string]string{"AUTH_MODE": "none"}, static)
	handler := server.Handler()

	root := do(t, handler, http.MethodGet, "/", "", nil)
	if root.Code != 200 || !strings.Contains(root.Body.String(), "app") {
		t.Fatalf("根路径应回退 index.html：%d", root.Code)
	}
	if ct := root.Header().Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Fatalf("根路径 Content-Type = %q", ct)
	}
	// SPA 回退的 index.html 必须 no-cache（对齐旧实现 serveStatic 的回退分支）。
	if cc := root.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("SPA 回退 Cache-Control = %q，期望 no-cache", cc)
	}
	asset := do(t, handler, http.MethodGet, "/assets/index.js", "", nil)
	if asset.Code != 200 || !strings.Contains(asset.Header().Get("Content-Type"), "javascript") {
		t.Fatalf("静态资源响应错误：%d %q", asset.Code, asset.Header().Get("Content-Type"))
	}
	if cc := asset.Header().Get("Cache-Control"); cc != "public, max-age=3600" {
		t.Fatalf("静态资源 Cache-Control = %q，期望 public, max-age=3600", cc)
	}
	// 带扩展名的缺失资源必须 404，不能回退 index.html。
	missing := do(t, handler, http.MethodGet, "/assets/missing.js", "", nil)
	if missing.Code != 404 {
		t.Fatalf("缺失静态资源应 404，得到 %d", missing.Code)
	}
}

// TestIndexHTMLCacheControl 锁定显式请求 /index.html 的缓存头：旧实现按「路径段非空」
// 判定，直接命中的 index.html 与其它静态文件同为 public, max-age=3600，绝非 HTML 特例。
func TestIndexHTMLCacheControl(t *testing.T) {
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>app</html>")}}
	server, _ := testServer(t, map[string]string{"AUTH_MODE": "none"}, static)

	rec := do(t, server.Handler(), http.MethodGet, "/index.html", "", nil)
	if rec.Code != 200 {
		t.Fatalf("GET /index.html 状态码 = %d，期望 200", rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=3600" {
		t.Fatalf("GET /index.html Cache-Control = %q，期望 public, max-age=3600", cc)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Fatalf("GET /index.html Content-Type = %q", ct)
	}
}

func TestServeStaticDisabled(t *testing.T) {
	server, _ := testServer(t, map[string]string{"AUTH_MODE": "none", "SERVE_STATIC": "0"}, nil)
	rec := do(t, server.Handler(), http.MethodGet, "/", "", nil)
	if rec.Code != 404 {
		t.Fatalf("关闭静态托管后根路径应为 404，得到 %d", rec.Code)
	}
}

func TestStaticOnlyBlocksAPI(t *testing.T) {
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>app</html>")}}
	server, _ := testServer(t, map[string]string{"AUTH_MODE": "none", "STATIC_ONLY": "1"}, static)
	handler := server.Handler()

	if rec := do(t, handler, http.MethodGet, "/", "", nil); rec.Code != 200 {
		t.Fatalf("纯静态模式根路径 = %d", rec.Code)
	}
	if rec := do(t, handler, http.MethodGet, "/api/health", "", nil); rec.Code != 404 {
		t.Fatalf("纯静态模式 /api 应为 404，得到 %d", rec.Code)
	}
}

func TestCORSPreflight(t *testing.T) {
	server, _ := testServer(t, map[string]string{
		"AUTH_MODE":       "none",
		"ALLOWED_ORIGINS": "https://app.example.com",
	}, nil)
	handler := server.Handler()

	preflight := do(t, handler, http.MethodOptions, "/api/data", "", map[string]string{"Origin": "https://app.example.com"})
	if preflight.Code != http.StatusNoContent {
		t.Fatalf("预检状态码 = %d，期望 204", preflight.Code)
	}
	if got := preflight.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Fatalf("Allow-Origin = %q", got)
	}
	if got := preflight.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("Allow-Credentials = %q", got)
	}

	// 未列入白名单的来源不回声。
	other := do(t, handler, http.MethodOptions, "/api/data", "", map[string]string{"Origin": "https://evil.example.com"})
	if other.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("非白名单来源不应回 CORS 头")
	}
}

func TestUnsupportedRelayMethodReturns405(t *testing.T) {
	server, _ := testServer(t, map[string]string{"AUTH_MODE": "none"}, nil)
	rec := do(t, server.Handler(), http.MethodPatch, "/api/webdav", "", nil)
	if rec.Code != 405 || decode(t, rec)["error"] != "method_not_allowed" {
		t.Fatalf("不支持的转发动词响应错误：%d %s", rec.Code, rec.Body.String())
	}
}
