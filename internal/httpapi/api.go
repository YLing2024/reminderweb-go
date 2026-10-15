// Package httpapi 实现 HTTP 路由装配、CORS、请求体读取与静态托管（旧 server/src/http.ts + routes/*）。
//
// 只用标准库 net/http：请求处理流程为「解析 URL → 按路由读体（含体积上限）→ 解析身份 →
// 分发路由 / 静态文件 → 写响应」。统一错误体为 `{error, message?}`，错误码与中文文案对齐旧实现。
package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"reminderweb-go/internal/auth"
	"reminderweb-go/internal/config"
	"reminderweb-go/internal/store"
	"reminderweb-go/internal/sync"
	"reminderweb-go/internal/wire"
)

// 请求体大小上限。
const (
	// MaxBodyBytes 默认上限：2 MiB。
	MaxBodyBytes = 2 * 1024 * 1024
	// MaxReplaceBodyBytes 整库替换上限：32 MiB（含 base64 图片）。
	MaxReplaceBodyBytes = 32 * 1024 * 1024
	// MaxRelayBodyBytes WebDAV 转发上限：64 MiB（备份包可能较大）。
	MaxRelayBodyBytes = 64 * 1024 * 1024
)

// 跨域预检允许的方法与头（前后端分离部署）。
const (
	corsAllowMethods = "GET, PUT, POST, DELETE, OPTIONS"
	corsAllowHeaders = "Content-Type, Depth, If-Match, X-Dav-Url, X-Dav-User, X-Dav-Password"
)

// HttpError 是统一业务错误：状态码 + 稳定错误码。
type HttpError struct {
	Status int
	Code   string
}

func (e *HttpError) Error() string { return e.Code }

// Context 是单次请求的处理上下文。
type Context struct {
	Method      string
	Path        string
	Headers     http.Header
	Body        any
	RawBody     []byte
	Identity    *auth.Identity
	Config      *config.Config
	DB          *store.DB
	Now         int64
	IP          string
	RateLimiter *auth.RateLimiter
	Sync        *sync.Engine
	Request     *http.Request
}

// Response 是路由处理结果；RawBody 非 nil 时忽略 Body。
type Response struct {
	Status  int
	Body    any
	Headers map[string]string
	Cookies []string
	RawBody []byte
}

// Handler 是路由处理函数。
type Handler func(*Context) (Response, error)

type bodyKind int

const (
	bodyNone bodyKind = iota
	bodyJSON
	bodyRaw
)

// Server 是 HTTP 服务装配体。
type Server struct {
	config      *config.Config
	db          *store.DB
	rateLimiter *auth.RateLimiter
	sync        *sync.Engine
	logger      *slog.Logger
	now         func() int64
	static      staticSource
	mux         *http.ServeMux
}

// Options 是装配参数。
type Options struct {
	Config      *config.Config
	DB          *store.DB
	RateLimiter *auth.RateLimiter
	Sync        *sync.Engine
	Logger      *slog.Logger
	Now         func() int64
	// StaticFS 是嵌在前端产物目录（已定位到 dist 根）。
	StaticFS staticSource
}

// New 创建服务装配体并注册路由。
func New(options Options) *Server {
	server := &Server{
		config:      options.Config,
		db:          options.DB,
		rateLimiter: options.RateLimiter,
		sync:        options.Sync,
		logger:      options.Logger,
		now:         options.Now,
		static:      options.StaticFS,
		mux:         http.NewServeMux(),
	}
	if server.static == nil {
		server.static = &emptyStatic{}
	}
	server.routes()
	return server
}

func (s *Server) timestamp() int64 {
	if s.now != nil {
		return s.now()
	}
	return time.Now().UnixMilli()
}

// Handler 返回顶层 http.Handler：CORS / 预检 / 静态托管 / API 分发。
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.config.StaticOnly {
			s.serveStaticOnly(w, r)
			return
		}
		path := r.URL.Path
		corsAllowed := s.applyCORS(w, r)
		if r.Method == http.MethodOptions && strings.HasPrefix(path, "/api/") {
			if corsAllowed {
				w.Header().Set("Access-Control-Allow-Methods", corsAllowMethods)
				w.Header().Set("Access-Control-Allow-Headers", corsAllowHeaders)
				w.Header().Set("Access-Control-Max-Age", "600")
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !strings.HasPrefix(path, "/api/") {
			if s.config.ServeStatic {
				s.serveStatic(w, r)
			} else {
				sendError(w, http.StatusNotFound, "not_found", nil, nil)
			}
			return
		}
		s.mux.ServeHTTP(w, r)
	})
}

func (s *Server) serveStaticOnly(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if strings.HasPrefix(path, "/api/") {
		sendError(w, http.StatusNotFound, "not_found", nil, nil)
		return
	}
	s.serveStatic(w, r)
}

// applyCORS 按白名单写 CORS 头；返回该来源是否命中白名单。
func (s *Server) applyCORS(w http.ResponseWriter, r *http.Request) bool {
	if len(s.config.AllowedOrigins) == 0 {
		return false
	}
	w.Header().Add("Vary", "Origin")
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	for _, allowed := range s.config.AllowedOrigins {
		if allowed == origin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			return true
		}
	}
	return false
}

// wrap 把路由处理函数包成 http.HandlerFunc：读体 → 解析身份 → 调用 → 写响应。
func (s *Server) wrap(kind bodyKind, limit int64, public bool, handler Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := &Context{
			Method:      r.Method,
			Path:        r.URL.Path,
			Headers:     r.Header,
			Config:      s.config,
			DB:          s.db,
			Now:         s.timestamp(),
			RateLimiter: s.rateLimiter,
			Sync:        s.sync,
			Request:     r,
			IP:          auth.ClientIP(r.Header, r.RemoteAddr, s.config.TrustProxy),
		}
		switch kind {
		case bodyJSON:
			body, err := readJSONBody(r, limit)
			if err != nil {
				writeError(w, err)
				return
			}
			ctx.Body = body
		case bodyRaw:
			raw, err := readRawBody(r, limit)
			if err != nil {
				writeError(w, err)
				return
			}
			ctx.RawBody = raw
		}

		identity := auth.ResolveIdentity(r.Header, auth.AuthDeps{Mode: s.config.AuthMode, DB: s.db, Now: s.now})
		if !public {
			if identity == nil {
				sendError(w, http.StatusUnauthorized, "unauthorized", nil, nil)
				return
			}
		}
		ctx.Identity = identity

		response, err := handler(ctx)
		if err != nil {
			writeError(w, err)
			return
		}
		writeResponse(w, response)
	}
}

func writeError(w http.ResponseWriter, err error) {
	var httpErr *HttpError
	if errors.As(err, &httpErr) {
		sendError(w, httpErr.Status, httpErr.Code, nil, nil)
		return
	}
	sendError(w, http.StatusInternalServerError, "internal_error", nil, nil)
}

// sendError 发送统一错误体；message 非空时附带可读原因。
func sendError(w http.ResponseWriter, status int, code string, message *string, cookies []string) {
	body := map[string]any{"error": code}
	if message != nil {
		body["message"] = *message
	}
	writeResponse(w, Response{Status: status, Body: body, Cookies: cookies})
}

func sendJSON(status int, body any) Response { return Response{Status: status, Body: body} }

func sendJSONWithCookies(status int, body any, cookies []string) Response {
	return Response{Status: status, Body: body, Cookies: cookies}
}

func messageError(status int, code, message string) Response {
	return Response{Status: status, Body: map[string]any{"error": code, "message": message}}
}

func writeResponse(w http.ResponseWriter, response Response) {
	if len(response.Cookies) > 0 {
		w.Header()["Set-Cookie"] = response.Cookies
	}
	if response.RawBody != nil {
		for name, value := range response.Headers {
			w.Header().Set(name, value)
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		status := response.Status
		if status == 0 {
			status = http.StatusOK
		}
		w.WriteHeader(status)
		_, _ = w.Write(response.RawBody)
		return
	}
	payload, err := json.Marshal(response.Body)
	if err != nil {
		payload = []byte(`{"error":"internal_error"}`)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write(payload)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	for name, value := range response.Headers {
		w.Header().Set(name, value)
	}
	status := response.Status
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	if response.Body != nil {
		_, _ = w.Write(payload)
	} else {
		_, _ = w.Write([]byte("null"))
	}
}

func readJSONBody(r *http.Request, limit int64) (any, error) {
	data, err := readRawBody(r, limit)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, nil
	}
	parsed, err := wire.DecodeJSON(data)
	if err != nil {
		return nil, &HttpError{Status: http.StatusBadRequest, Code: "invalid_json"}
	}
	return parsed, nil
}

func readRawBody(r *http.Request, limit int64) ([]byte, error) {
	reader := io.LimitReader(r.Body, limit+1)
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, &HttpError{Status: http.StatusBadRequest, Code: "invalid_body"}
	}
	if int64(len(data)) > limit {
		return nil, &HttpError{Status: http.StatusRequestEntityTooLarge, Code: "payload_too_large"}
	}
	return data, nil
}

// decodePathComponent 解码 URL 路径分量；失败返回 false。
func decodePathComponent(raw string) (string, bool) {
	decoded, err := url.PathUnescape(raw)
	if err != nil {
		return "", false
	}
	return decoded, true
}

// asHTTPError 判断错误是否为 *HttpError。
func asHTTPError(err error, target **HttpError) bool { return errors.As(err, target) }

// withTransaction 在一个事务里执行 fn；fn 返回错误即回滚。
func withTransaction(db *store.DB, fn func(store.Querier) error) error {
	tx, err := db.SQL().Begin()
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}
