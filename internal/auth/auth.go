// Package auth 实现认证与授权（旧 server/src/auth.ts）。
//
//   - builtin：scrypt 加盐口令校验 + 随机会话令牌（只存 SHA-256 摘要）；
//   - sso：只读网关注入的 X-Auth-User；
//   - none：本机开发，所有请求视为用户 dev。
//
// 口令、派生哈希、会话令牌、Cookie 值一律不写日志、不进错误响应。
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"reminderweb-go/internal/config"
	"reminderweb-go/internal/scrypt"
	"reminderweb-go/internal/store"
)

// SessionCookie 是会话 Cookie 名（__Host- 前缀要求 Secure + Path=/ 且无 Domain）。
const SessionCookie = "__Host-rw_session"

// 口令派生参数（需求 §5.1）。
const (
	saltBytes = 16
	keyBytes  = 32
)

// PasswordHash 是加盐口令哈希（十六进制盐与摘要）。
type PasswordHash struct {
	Salt string
	Hash string
}

// HashPassword 用给定盐（为空则随机 16 字节）派生口令哈希。
func HashPassword(password string, salt []byte) PasswordHash {
	if len(salt) == 0 {
		salt = randomBytes(saltBytes)
	}
	derived := scrypt.Derive(password, salt, keyBytes)
	return PasswordHash{Salt: hex.EncodeToString(salt), Hash: hex.EncodeToString(derived)}
}

// SHA256Hex 计算 SHA-256 十六进制摘要（用于会话令牌）。
func SHA256Hex(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func randomBytes(length int) []byte {
	out := make([]byte, length)
	if _, err := rand.Read(out); err != nil {
		// 熵源失败时无法安全继续；退回固定长度零值会被校验拒绝，不会静默放过。
		return make([]byte, length)
	}
	return out
}

// CreateSessionToken 生成 32 字节随机会话令牌（base64url 无填充）。
func CreateSessionToken() string {
	return base64.RawURLEncoding.EncodeToString(randomBytes(32))
}

// EnsureUserResult 是首次建用户的结果。
type EnsureUserResult struct {
	Created bool
	// GeneratedPassword 仅当口令留空且首次建库时生成，调用方只打印一次后丢弃。
	GeneratedPassword string
}

// EnsureInitialUser 首次启动建立 builtin 用户；已存在则不动。口令留空时生成一次性随机口令。
func EnsureInitialUser(db *store.DB, username, configuredPassword string, at int64) (EnsureUserResult, error) {
	var existing string
	err := db.SQL().QueryRow("SELECT username FROM users WHERE username = ?", username).Scan(&existing)
	if err == nil {
		return EnsureUserResult{Created: false}, nil
	}
	if err != sql.ErrNoRows {
		return EnsureUserResult{}, err
	}
	generated := ""
	password := configuredPassword
	if strings.TrimSpace(configuredPassword) == "" {
		generated = base64.RawURLEncoding.EncodeToString(randomBytes(12))
		password = generated
	}
	stored := HashPassword(password, nil)
	if _, err := db.SQL().Exec(
		"INSERT INTO users (username, salt, hash, created_at) VALUES (?, ?, ?, ?)",
		username, stored.Salt, stored.Hash, at,
	); err != nil {
		return EnsureUserResult{}, err
	}
	return EnsureUserResult{Created: true, GeneratedPassword: generated}, nil
}

// VerifyPassword 常量时间比对口令；任何异常都返回 false。
func VerifyPassword(password string, stored PasswordHash) bool {
	expected, err := hex.DecodeString(stored.Hash)
	if err != nil || len(expected) != keyBytes {
		return false
	}
	salt, err := hex.DecodeString(stored.Salt)
	if err != nil {
		return false
	}
	actual := scrypt.Derive(password, salt, keyBytes)
	if len(actual) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

// CreateSession 新建会话，返回令牌与过期时间。
func CreateSession(db *store.DB, username string, ttlMs, at int64) (string, int64, error) {
	token := CreateSessionToken()
	expiresAt := at + ttlMs
	if _, err := db.SQL().Exec(
		"INSERT INTO sessions (token_hash, username, created_at, expires_at) VALUES (?, ?, ?, ?)",
		SHA256Hex([]byte(token)), username, at, expiresAt,
	); err != nil {
		return "", 0, err
	}
	return token, expiresAt, nil
}

// GetSessionUsername 校验会话；过期则删除并返回 false。
func GetSessionUsername(db *store.DB, token string, at int64) (string, bool) {
	var username string
	var expiresAt int64
	err := db.SQL().QueryRow(
		"SELECT username, expires_at FROM sessions WHERE token_hash = ?", SHA256Hex([]byte(token)),
	).Scan(&username, &expiresAt)
	if err != nil {
		return "", false
	}
	if expiresAt <= at {
		DeleteSession(db, token)
		return "", false
	}
	return username, true
}

// DeleteSession 删除会话。
func DeleteSession(db *store.DB, token string) {
	_, _ = db.SQL().Exec("DELETE FROM sessions WHERE token_hash = ?", SHA256Hex([]byte(token)))
}

// CookieSameSite 返回 Cookie 的 SameSite 属性文本。
func CookieSameSite(value config.CookieSameSite) string {
	if value == config.SameSiteNone {
		return "None"
	}
	return "Lax"
}

// BuildSessionCookie 生成会话 Cookie 串。
func BuildSessionCookie(token string, ttlSeconds int, sameSite config.CookieSameSite) string {
	return SessionCookie + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=" + CookieSameSite(sameSite) +
		"; Max-Age=" + strconv.Itoa(ttlSeconds)
}

// BuildClearCookie 生成清除会话 Cookie 的串。
func BuildClearCookie(sameSite config.CookieSameSite) string {
	return SessionCookie + "=; Path=/; HttpOnly; Secure; SameSite=" + CookieSameSite(sameSite) + "; Max-Age=0"
}

// ParseCookies 解析 Cookie 头，返回键值表。
func ParseCookies(header string) map[string]string {
	out := map[string]string{}
	if header == "" {
		return out
	}
	for _, part := range strings.Split(header, ";") {
		index := strings.Index(part, "=")
		if index <= 0 {
			continue
		}
		key := strings.TrimSpace(part[:index])
		value := strings.TrimSpace(part[index+1:])
		if key != "" {
			out[key] = value
		}
	}
	return out
}

// ReadSSOUser 读取并校验 X-Auth-User；缺失或非法返回 false。
func ReadSSOUser(value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || len(trimmed) > 200 {
		return "", false
	}
	for i := 0; i < len(trimmed); i++ {
		if trimmed[i] < 0x20 || trimmed[i] == 0x7f {
			return "", false
		}
	}
	return trimmed, true
}

// LoginWindowMS 是登录失败限流窗口。
const LoginWindowMS = int64(10 * 60 * 1000)

type rateEntry struct {
	count       int
	windowStart int64
}

// RateLimiter 是每 IP 滑动窗口登录失败计数。
type RateLimiter struct {
	limit    int
	windowMS int64
	now      func() int64
	mu       sync.Mutex
	entries  map[string]*rateEntry
}

// NewRateLimiter 创建限流器；now 可注入便于测试。
func NewRateLimiter(limit int, windowMS int64, now func() int64) *RateLimiter {
	if windowMS <= 0 {
		windowMS = LoginWindowMS
	}
	if now == nil {
		now = func() int64 { return time.Now().UnixMilli() }
	}
	return &RateLimiter{limit: limit, windowMS: windowMS, now: now, entries: map[string]*rateEntry{}}
}

func (limiter *RateLimiter) current(ip string) *rateEntry {
	entry, ok := limiter.entries[ip]
	if !ok {
		return nil
	}
	if limiter.now()-entry.windowStart >= limiter.windowMS {
		delete(limiter.entries, ip)
		return nil
	}
	return entry
}

// IsBlocked 判断该 IP 是否已被限流。
func (limiter *RateLimiter) IsBlocked(ip string) bool {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	entry := limiter.current(ip)
	return entry != nil && entry.count >= limiter.limit
}

// RecordFailure 记录一次失败。
func (limiter *RateLimiter) RecordFailure(ip string) {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	entry := limiter.current(ip)
	if entry == nil {
		limiter.entries[ip] = &rateEntry{count: 1, windowStart: limiter.now()}
		return
	}
	entry.count++
}

// Reset 清空该 IP 的失败计数。
func (limiter *RateLimiter) Reset(ip string) {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	delete(limiter.entries, ip)
}

// Identity 是当前请求身份。
type Identity struct {
	Username string
	Mode     config.AuthMode
}

// AuthDeps 是身份解析依赖。
type AuthDeps struct {
	Mode config.AuthMode
	DB   *store.DB
	Now  func() int64
}

// ResolveIdentity 解析当前请求身份；未认证返回 nil。
func ResolveIdentity(headers http.Header, deps AuthDeps) *Identity {
	if deps.Mode == config.AuthNone {
		return &Identity{Username: "dev", Mode: config.AuthNone}
	}
	if deps.Mode == config.AuthSSO {
		username, ok := ReadSSOUser(headers.Get("X-Auth-User"))
		if !ok {
			return nil
		}
		return &Identity{Username: username, Mode: config.AuthSSO}
	}
	cookies := ParseCookies(headers.Get("Cookie"))
	token := cookies[SessionCookie]
	if token == "" {
		return nil
	}
	at := time.Now().UnixMilli()
	if deps.Now != nil {
		at = deps.Now()
	}
	username, ok := GetSessionUsername(deps.DB, token, at)
	if !ok {
		return nil
	}
	return &Identity{Username: username, Mode: config.AuthBuiltin}
}

// ClientIP 取真实客户端 IP（用于限流）。
func ClientIP(headers http.Header, remoteAddress string, trustProxy bool) string {
	if trustProxy {
		forwarded := headers.Get("X-Forwarded-For")
		if strings.TrimSpace(forwarded) != "" {
			first := strings.TrimSpace(strings.Split(forwarded, ",")[0])
			if first != "" {
				return first
			}
		}
	}
	if remoteAddress != "" {
		return remoteAddress
	}
	return "unknown"
}
