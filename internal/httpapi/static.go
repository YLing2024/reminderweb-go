package httpapi

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// staticSource 是静态产物来源（嵌入的 dist 目录）。
type staticSource interface {
	Open(name string) (fs.File, error)
}

// emptyStatic 在未嵌入产物时使用：所有路径都视为不存在。
type emptyStatic struct{}

func (emptyStatic) Open(string) (fs.File, error) { return nil, fs.ErrNotExist }

var mimeTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json; charset=utf-8",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".jpg":         "image/jpeg",
	".jpeg":        "image/jpeg",
	".gif":         "image/gif",
	".webp":        "image/webp",
	".ico":         "image/x-icon",
	".woff":        "font/woff",
	".woff2":       "font/woff2",
	".ttf":         "font/ttf",
	".txt":         "text/plain; charset=utf-8",
	".webmanifest": "application/manifest+json",
	".map":         "application/json; charset=utf-8",
}

func contentTypeFor(name string) string {
	if value, ok := mimeTypes[strings.ToLower(path.Ext(name))]; ok {
		return value
	}
	return "application/octet-stream"
}

// serveStatic 只允许 dist 下的普通文件；拒绝点文件与路径穿越；未知无扩展名路径回退 index.html。
func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	decoded := r.URL.Path
	segments := make([]string, 0, 4)
	for _, segment := range strings.Split(decoded, "/") {
		if segment == "" || segment == "." {
			continue
		}
		if segment == ".." || strings.HasPrefix(segment, ".") {
			sendError(w, http.StatusNotFound, "not_found", nil, nil)
			return
		}
		segments = append(segments, segment)
	}
	candidate := strings.Join(segments, "/")
	if candidate != "" {
		if info, err := fs.Stat(s.static, candidate); err == nil && info.Mode().IsRegular() {
			s.writeStaticFile(w, candidate, false)
			return
		}
	}
	// 带扩展名的静态资源（/assets/*.js|css|png…）找不到时必须 404，避免掩盖部署缺文件。
	if path.Ext(decoded) != "" {
		sendError(w, http.StatusNotFound, "not_found", nil, nil)
		return
	}
	if info, err := fs.Stat(s.static, "index.html"); err == nil && info.Mode().IsRegular() {
		s.writeStaticFile(w, "index.html", true)
		return
	}
	sendError(w, http.StatusNotFound, "not_found", nil, nil)
}

// writeStaticFile 写静态文件响应。缓存规则对齐旧实现（server/src/http.ts `serveStatic`）：
// 只有 SPA 回退（未知无扩展名路径回落到 index.html）才是 `no-cache`；
// 直接命中的静态文件——包括显式请求 `/index.html`——一律 `public, max-age=3600`。
// 旧实现按路径段是否为空区分，而非按文件类型，故 index.html 不是「HTML 特例」。
func (s *Server) writeStaticFile(w http.ResponseWriter, name string, spaFallback bool) {
	content, err := fs.ReadFile(s.static, name)
	if err != nil {
		sendError(w, http.StatusNotFound, "not_found", nil, nil)
		return
	}
	cache := "public, max-age=3600"
	if spaFallback {
		cache = "no-cache"
	}
	w.Header().Set("Content-Type", contentTypeFor(name))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", cache)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}
