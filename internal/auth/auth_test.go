package auth

import (
	"net/http"
	"strings"
	"testing"

	"reminderweb-go/internal/config"
	"reminderweb-go/internal/store"
	"reminderweb-go/internal/store/storetest"
)

func TestHashAndVerifyPassword(t *testing.T) {
	stored := HashPassword("correct horse battery staple", nil)
	if stored.Salt == "" || stored.Hash == "" {
		t.Fatal("盐与摘要都不应为空")
	}
	if !VerifyPassword("correct horse battery staple", stored) {
		t.Fatal("正确口令应通过校验")
	}
	if VerifyPassword("wrong", stored) {
		t.Fatal("错误口令不应通过校验")
	}
	// 摘要长度非法时直接判否，不 panic。
	if VerifyPassword("x", PasswordHash{Salt: stored.Salt, Hash: "abcd"}) {
		t.Fatal("非法摘要长度应判否")
	}
}

func TestSessionCookieAttributes(t *testing.T) {
	cookie := BuildSessionCookie("tok", 3600, config.SameSiteLax)
	for _, want := range []string{"__Host-rw_session=tok", "Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=3600"} {
		if !strings.Contains(cookie, want) {
			t.Fatalf("Cookie 缺少 %q：%s", want, cookie)
		}
	}
	if strings.Contains(cookie, "Domain=") {
		t.Fatalf("__Host- Cookie 不得带 Domain：%s", cookie)
	}
	if clear := BuildClearCookie(config.SameSiteNone); !strings.Contains(clear, "SameSite=None") || !strings.Contains(clear, "Max-Age=0") {
		t.Fatalf("清除 Cookie 形态错误：%s", clear)
	}
}

func TestParseCookies(t *testing.T) {
	out := ParseCookies("a=1; __Host-rw_session=xyz; b=2")
	if out["a"] != "1" || out["__Host-rw_session"] != "xyz" || out["b"] != "2" {
		t.Fatalf("解析 Cookie 错误：%+v", out)
	}
	if len(ParseCookies("")) != 0 {
		t.Fatal("空 Cookie 头应返回空表")
	}
}

func TestSessionLifecycle(t *testing.T) {
	db := openTestDB(t)
	token, expiresAt, err := CreateSession(db, "admin", 1000, 100)
	if err != nil {
		t.Fatalf("CreateSession 失败：%v", err)
	}
	if expiresAt != 1100 {
		t.Fatalf("过期时间 = %d，期望 1100", expiresAt)
	}
	if user, ok := GetSessionUsername(db, token, 500); !ok || user != "admin" {
		t.Fatalf("有效会话应命中：%q %v", user, ok)
	}
	// 过期：应失效并被删除。
	if _, ok := GetSessionUsername(db, token, 2000); ok {
		t.Fatal("过期会话不应有效")
	}
	if _, ok := GetSessionUsername(db, token, 500); ok {
		t.Fatal("过期会话被删除后不应再命中")
	}
}

func TestRateLimiter(t *testing.T) {
	now := int64(0)
	limiter := NewRateLimiter(2, 1000, func() int64 { return now })
	if limiter.IsBlocked("1.2.3.4") {
		t.Fatal("初始不应被封")
	}
	limiter.RecordFailure("1.2.3.4")
	limiter.RecordFailure("1.2.3.4")
	if !limiter.IsBlocked("1.2.3.4") {
		t.Fatal("达到上限后应被封")
	}
	limiter.Reset("1.2.3.4")
	if limiter.IsBlocked("1.2.3.4") {
		t.Fatal("Reset 后应解封")
	}
	// 窗口滑动后自动清零。
	limiter.RecordFailure("5.6.7.8")
	now = 2000
	if limiter.IsBlocked("5.6.7.8") {
		t.Fatal("窗口过期后计数应清零")
	}
}

func TestReadSSOUser(t *testing.T) {
	if _, ok := ReadSSOUser("   "); ok {
		t.Fatal("空白用户名应被拒")
	}
	if _, ok := ReadSSOUser("bad\x00user"); ok {
		t.Fatal("含控制字符应被拒")
	}
	if user, ok := ReadSSOUser("  alice  "); !ok || user != "alice" {
		t.Fatalf("合法用户名应被 trim 后接受：%q %v", user, ok)
	}
}

func TestClientIPTrustProxy(t *testing.T) {
	headers := http.Header{}
	headers.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.1")
	if ip := ClientIP(headers, "127.0.0.1:1234", true); ip != "203.0.113.7" {
		t.Fatalf("信任代理时应取首个 XFF，得到 %q", ip)
	}
	if ip := ClientIP(headers, "127.0.0.1:1234", false); ip != "127.0.0.1" {
		t.Fatalf("不信任代理时应取 RemoteAddr 的主机部分（去端口），得到 %q", ip)
	}
	if ip := ClientIP(http.Header{}, "[::1]:1234", false); ip != "::1" {
		t.Fatalf("IPv6 RemoteAddr 应去掉方括号与端口，得到 %q", ip)
	}
	if ip := ClientIP(http.Header{}, "", false); ip != "unknown" {
		t.Fatalf("空 RemoteAddr 应回落到 unknown，得到 %q", ip)
	}
}

func TestResolveIdentityModes(t *testing.T) {
	db := openTestDB(t)
	if id := ResolveIdentity(http.Header{}, AuthDeps{Mode: config.AuthNone, DB: db}); id == nil || id.Username != "dev" {
		t.Fatalf("none 模式应视为 dev：%+v", id)
	}
	ssoHeaders := http.Header{}
	ssoHeaders.Set("X-Auth-User", "gateway-user")
	if id := ResolveIdentity(ssoHeaders, AuthDeps{Mode: config.AuthSSO, DB: db}); id == nil || id.Username != "gateway-user" {
		t.Fatalf("sso 模式应取 X-Auth-User：%+v", id)
	}
	if id := ResolveIdentity(http.Header{}, AuthDeps{Mode: config.AuthSSO, DB: db}); id != nil {
		t.Fatal("sso 模式缺头应未认证")
	}
	if id := ResolveIdentity(http.Header{}, AuthDeps{Mode: config.AuthBuiltin, DB: db}); id != nil {
		t.Fatal("builtin 模式无 Cookie 应未认证")
	}
}

func openTestDB(t *testing.T) *store.DB {
	t.Helper()
	return storetest.Open(t)
}
