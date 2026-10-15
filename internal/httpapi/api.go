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
	routes      []parsedRoute
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
	}
	if server.static == nil {
		server.static = &emptyStatic{}
	}
	server.routes = parseRoutes(server.routeTable())
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
		s.dispatch(w, r)
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

// apiRoute 描述一条 API 路由。pattern 既是匹配依据，也是
// scripts/check-api-docs.mjs 与 docs/API.md 机检对照的字面量锚点：
// 形如 "METHOD /path" 的条目各自需要一条文档标题；不带方法前缀的
// （如转发兜底 "/api/webdav"）表示任意方法，机检自动忽略。
type apiRoute struct {
	pattern    string
	prefixPath string
	nameParam  string
	public     bool
	handler    Handler
}

// parsedRoute 是 apiRoute 解析后的匹配形态：方法 + 精确路径 / 前缀。
type parsedRoute struct {
	method     string
	path       string
	prefixPath string
	nameParam  string
	public     bool
	handler    Handler
}

func parseRoutes(table []apiRoute) []parsedRoute {
	out := make([]parsedRoute, 0, len(table))
	for _, rt := range table {
		method, path := splitPattern(rt.pattern)
		out = append(out, parsedRoute{
			method:     method,
			path:       path,
			prefixPath: rt.prefixPath,
			nameParam:  rt.nameParam,
			public:     rt.public,
			handler:    rt.handler,
		})
	}
	return out
}

// splitPattern 把 "METHOD /path" 拆成方法与路径；无方法前缀时方法为空（任意方法）。
func splitPattern(pattern string) (string, string) {
	if idx := strings.IndexByte(pattern, ' '); idx >= 0 {
		return pattern[:idx], pattern[idx+1:]
	}
	return "", pattern
}

// matchRoute 按注册顺序找第一条命中的路由；未命中返回 false。
// 精确条目比对完整路径，前缀条目比对 prefixPath（旧 dispatch 的顺序语义）。
func (s *Server) matchRoute(method, path string) (*parsedRoute, bool) {
	for i := range s.routes {
		route := &s.routes[i]
		if route.method != "" && route.method != method {
			continue
		}
		if route.prefixPath != "" {
			if strings.HasPrefix(path, route.prefixPath) {
				return route, true
			}
			continue
		}
		if path == route.path {
			return route, true
		}
	}
	return nil, false
}

// dispatch 是 /api/* 的总入口，逐条对齐旧 http.ts 的 handleRequest + dispatch：
// 先按「方法 + 路径」读体（含体积上限），再解析身份（仅 PUBLIC_ROUTES 免认证），
// 最后精确分发；未命中一律 404。绝不依赖 ServeMux 的方法推断（其 GET 模式会误配 HEAD）。
func (s *Server) dispatch(w http.ResponseWriter, r *http.Request) {
	// 用转义后的原始路径做匹配与取名，贴近旧实现直接读取 req.url 的行为：
	// 已编码的路径不会被解码后误命中（如 /api/%64ata 在旧实现同样不命中）。
	rawPath := r.URL.EscapedPath()
	ctx := &Context{
		Method:      r.Method,
		Path:        rawPath,
		Headers:     r.Header,
		Config:      s.config,
		DB:          s.db,
		Now:         s.timestamp(),
		RateLimiter: s.rateLimiter,
		Sync:        s.sync,
		Request:     r,
		IP:          auth.ClientIP(r.Header, r.RemoteAddr, s.config.TrustProxy),
	}

	// 读体（含 413 / 400 兜底）发生在身份校验之前，与旧实现一致。
	switch kind, limit := bodyPlan(r.Method, rawPath); kind {
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

	route, matched := s.matchRoute(r.Method, rawPath)
	// 公开路由固定不解析身份（与旧实现 PUBLIC_ROUTES 相同）；其余（含未命中）先鉴权。
	if matched && route.public {
		ctx.Identity = nil
	} else {
		identity := auth.ResolveIdentity(r.Header, auth.AuthDeps{Mode: s.config.AuthMode, DB: s.db, Now: s.now})
		if identity == nil {
			sendError(w, http.StatusUnauthorized, "unauthorized", nil, nil)
			return
		}
		ctx.Identity = identity
	}

	if !matched {
		writeResponse(w, Response{Status: http.StatusNotFound, Body: map[string]any{"error": "not_found"}})
		return
	}
	if route.nameParam != "" {
		r.SetPathValue(route.nameParam, routeName(route, rawPath))
	}
	response, err := route.handler(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	writeResponse(w, response)
}

// routeName 取前缀路由的路径参数（旧实现用 decodeURIComponent 解一次）；解码失败返回空串，
// 由处理器按「非法名称」处理。
func routeName(route *parsedRoute, rawPath string) string {
	value := rawPath[len(route.prefixPath):]
	decoded, err := url.PathUnescape(value)
	if err != nil {
		return ""
	}
	return decoded
}

// bodyPlan 按「方法 + 路径」决定请求体形态与上限，对齐旧 bodyLimitFor / isBinaryBodyRoute。
func bodyPlan(method, path string) (bodyKind, int64) {
	switch {
	case isBinaryBodyRoute(method, path):
		return bodyRaw, bodyLimitFor(method, path)
	case method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch:
		return bodyJSON, bodyLimitFor(method, path)
	default:
		return bodyNone, 0
	}
}

// isRelayPath 判断是否为 WebDAV 转发子路径；`/api/webdav/config` 是普通 JSON 设置接口，不算转发。
func isRelayPath(path string) bool {
	if path == "/api/webdav/config" {
		return false
	}
	return strings.HasPrefix(path, "/api/webdav/")
}

// bodyLimitFor 按路由选择请求体上限：整库替换与转发更宽松；其余保持 2 MiB。
func bodyLimitFor(method, path string) int64 {
	if method == http.MethodPut && path == "/api/data/replace" {
		return MaxReplaceBodyBytes
	}
	if path == "/api/webdav" || isRelayPath(path) {
		return MaxRelayBodyBytes
	}
	return MaxBodyBytes
}

func isBinaryBodyRoute(method, path string) bool {
	if path == "/api/webdav" || isRelayPath(path) {
		return true
	}
	return strings.HasPrefix(path, "/api/images/") && (method == http.MethodPut || method == http.MethodPost)
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
