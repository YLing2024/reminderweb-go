package httpapi

import (
	"database/sql"
	"strings"
	"sync"
	"time"

	"reminderweb-go/internal/auth"
	"reminderweb-go/internal/config"
	"reminderweb-go/internal/wire"
)

// LoginFailureDelayMS 是登录失败固定延迟，防用户枚举。
const LoginFailureDelayMS = 150

var (
	dummyHashOnce sync.Once
	dummyHash     auth.PasswordHash
)

func getDummyHash() auth.PasswordHash {
	dummyHashOnce.Do(func() {
		salt := []byte("0000000000000000")
		dummyHash = auth.HashPassword("__not_a_real_password__", salt)
	})
	return dummyHash
}

func readLoginBody(body any) (string, string, bool) {
	record, ok := wire.IsRecord(body)
	if !ok {
		return "", "", false
	}
	username, okUser := record["username"].(string)
	password, okPassword := record["password"].(string)
	if !okUser || !okPassword {
		return "", "", false
	}
	trimmed := strings.TrimSpace(username)
	if trimmed == "" || password == "" {
		return "", "", false
	}
	return trimmed, password, true
}

func (s *Server) handleLogin(ctx *Context) (Response, error) {
	if ctx.Config.AuthMode != config.AuthBuiltin {
		return sendJSON(400, map[string]any{"error": "login_not_available"}), nil
	}
	username, password, ok := readLoginBody(ctx.Body)
	if !ok {
		return sendJSON(400, map[string]any{"error": "invalid_request"}), nil
	}
	if ctx.RateLimiter != nil && ctx.RateLimiter.IsBlocked(ctx.IP) {
		return sendJSON(429, map[string]any{"error": "too_many_requests"}), nil
	}

	var storedSalt, storedHash string
	err := ctx.DB.SQL().QueryRow("SELECT salt, hash FROM users WHERE username = ?", username).Scan(&storedSalt, &storedHash)
	authenticated := false
	if err == sql.ErrNoRows {
		// 用户不存在也做一次 scrypt，避免时间侧信道枚举用户。
		auth.VerifyPassword(password, getDummyHash())
	} else if err != nil {
		return Response{}, err
	} else {
		authenticated = auth.VerifyPassword(password, auth.PasswordHash{Salt: storedSalt, Hash: storedHash})
	}

	if !authenticated {
		if ctx.RateLimiter != nil {
			ctx.RateLimiter.RecordFailure(ctx.IP)
		}
		time.Sleep(LoginFailureDelayMS * time.Millisecond)
		return sendJSON(401, map[string]any{"error": "invalid_credentials"}), nil
	}
	if ctx.RateLimiter != nil {
		ctx.RateLimiter.Reset(ctx.IP)
	}
	ttlMs := int64(ctx.Config.SessionTTLDays) * 24 * 60 * 60 * 1000
	token, _, err := auth.CreateSession(ctx.DB, username, ttlMs, ctx.Now)
	if err != nil {
		return Response{}, err
	}
	_ = ctx.DB.Audit(ctx.Now, username, "login", nil)
	cookie := auth.BuildSessionCookie(token, int(ttlMs/1000), ctx.Config.CookieSameSite)
	return sendJSONWithCookies(200, map[string]any{"username": username}, []string{cookie}), nil
}

func (s *Server) handleLogout(ctx *Context) (Response, error) {
	cookies := auth.ParseCookies(ctx.Headers.Get("Cookie"))
	if token := cookies[auth.SessionCookie]; token != "" {
		auth.DeleteSession(ctx.DB, token)
	}
	return sendJSONWithCookies(200, map[string]any{"ok": true}, []string{auth.BuildClearCookie(ctx.Config.CookieSameSite)}), nil
}

func (s *Server) handleMe(ctx *Context) (Response, error) {
	if ctx.Identity == nil {
		return sendJSON(401, map[string]any{"error": "unauthorized"}), nil
	}
	return sendJSON(200, map[string]any{
		"username": ctx.Identity.Username,
		"authMode": string(ctx.Identity.Mode),
	}), nil
}
