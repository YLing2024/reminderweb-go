// Command fakedav 是一个仅供本地验收使用的隔离 WebDAV 服务。
//
// 它只实现本应用同步引擎用到的动词（PROPFIND Depth:1 / MKCOL / PUT / GET / DELETE），
// 存放在内存里，绝不参与生产部署，也不读写真实 NAS。目的：不依赖外部服务即可复现
// 「本地改一条 → 触发同步 → 远端出现；远端改一条 → 拉回本地」的全链路。
package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// entry 是一个内存中的远端文件。
type entry struct {
	bytes    []byte
	modified time.Time
}

// store 是按路径索引的内存文件系统。
type store struct {
	mu      sync.Mutex
	files   map[string]entry
	dirs    map[string]bool
	user    string
	pass    string
	failPut bool
}

func (s *store) authorized(r *http.Request) bool {
	if s.user == "" {
		return true
	}
	u, p, ok := r.BasicAuth()
	return ok && u == s.user && p == s.pass
}

func (s *store) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		w.Header().Set("WWW-Authenticate", `Basic realm="fakedav"`)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	path := strings.TrimSuffix(r.URL.Path, "/")
	if path == "" {
		path = "/"
	}
	switch r.Method {
	case "MKCOL":
		s.mu.Lock()
		s.dirs[path] = true
		s.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
	case "PROPFIND":
		s.propfind(w, path)
	case "PUT":
		if s.failPut {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		s.files[path] = entry{bytes: body, modified: time.Now().UTC()}
		s.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
	case "GET":
		s.mu.Lock()
		file, ok := s.files[path]
		s.mu.Unlock()
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/zip")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(file.bytes)
	case "DELETE":
		s.mu.Lock()
		_, ok := s.files[path]
		delete(s.files, path)
		s.mu.Unlock()
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case "HEAD":
		s.mu.Lock()
		_, ok := s.files[path]
		s.mu.Unlock()
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// propfind 返回 Depth:1 的多状态 XML；根路径列出全部文件，子路径只看自身。
func (s *store) propfind(w http.ResponseWriter, path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	names := make([]string, 0, len(s.files))
	for name := range s.files {
		names = append(names, name)
	}
	sort.Strings(names)

	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="utf-8"?>`)
	b.WriteString(`<D:multistatus xmlns:D="DAV:">`)
	for _, name := range names {
		if path != "/" && !strings.HasPrefix(name, path+"/") {
			continue
		}
		file := s.files[name]
		b.WriteString(`<D:response><D:href>`)
		b.WriteString(name)
		b.WriteString(`</D:href><D:propstat><D:prop>`)
		b.WriteString(fmt.Sprintf(`<D:getcontentlength>%d</D:getcontentlength>`, len(file.bytes)))
		b.WriteString(`<D:getlastmodified>` + file.modified.Format(http.TimeFormat) + `</D:getlastmodified>`)
		b.WriteString(fmt.Sprintf(`<D:getetag>"%d"</D:getetag>`, file.modified.UnixNano()))
		b.WriteString(`</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`)
	}
	b.WriteString(`</D:multistatus>`)

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(http.StatusMultiStatus)
	_, _ = io.WriteString(w, b.String())
}

func main() {
	addr := flag.String("addr", "127.0.0.1:19241", "监听地址（仅限回环）")
	user := flag.String("user", "", "Basic 认证用户名（留空则不校验）")
	pass := flag.String("pass", "", "Basic 认证口令")
	failPut := flag.Bool("fail-put", false, "让所有 PUT 返回 500（用于测试远端故障）")
	flag.Parse()

	host, _, err := net.SplitHostPort(*addr)
	if err != nil || (host != "127.0.0.1" && host != "::1" && host != "localhost") {
		log.Fatalf("fakedav 只允许监听回环地址，当前为 %q", *addr)
	}

	handler := &store{files: map[string]entry{}, dirs: map[string]bool{}, user: *user, pass: *pass, failPut: *failPut}
	server := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("fakedav 已启动：http://%s（用户 %q，failPut=%v）", *addr, *user, *failPut)
	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
