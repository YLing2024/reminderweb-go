package httpapi

// routes 注册全部路由。
//
// 路径与语义逐条对齐旧 server/src/http.ts 的 dispatch 与 routes/*：任何一条都不许遗漏或改形。
// 每条以字面量的 "METHOD /path" 形式注册，供 scripts/check-api-docs.mjs 与 docs/API.md 机检对照。
func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.wrap(bodyNone, 0, true, s.handleHealth))
	s.mux.HandleFunc("GET /api/version", s.wrap(bodyNone, 0, true, s.handleVersion))

	s.mux.HandleFunc("POST /api/auth/login", s.wrap(bodyJSON, MaxBodyBytes, true, s.handleLogin))
	s.mux.HandleFunc("POST /api/auth/logout", s.wrap(bodyNone, 0, false, s.handleLogout))
	s.mux.HandleFunc("GET /api/auth/me", s.wrap(bodyNone, 0, false, s.handleMe))

	s.mux.HandleFunc("GET /api/data", s.wrap(bodyNone, 0, false, s.handleGetData))
	s.mux.HandleFunc("GET /api/data/full", s.wrap(bodyNone, 0, false, s.handleGetFullData))
	s.mux.HandleFunc("PUT /api/data", s.wrap(bodyJSON, MaxBodyBytes, false, s.handlePutData))
	s.mux.HandleFunc("PUT /api/data/replace", s.wrap(bodyJSON, MaxReplaceBodyBytes, false, s.handlePutReplace))

	s.mux.HandleFunc("PUT /api/images/{name}", s.wrap(bodyRaw, MaxBodyBytes, false, s.handlePutImage))
	s.mux.HandleFunc("GET /api/images/{name}", s.wrap(bodyNone, 0, false, s.handleGetImage))
	s.mux.HandleFunc("DELETE /api/images/{name}", s.wrap(bodyNone, 0, false, s.handleDeleteImage))

	s.mux.HandleFunc("GET /api/webdav/config", s.wrap(bodyNone, 0, false, s.handleWebdavConfigGet))
	s.mux.HandleFunc("PUT /api/webdav/config", s.wrap(bodyJSON, MaxBodyBytes, false, s.handleWebdavConfigPut))

	s.mux.HandleFunc("PROPFIND /api/webdav", s.wrap(bodyRaw, MaxRelayBodyBytes, false, s.handleRelay))
	s.mux.HandleFunc("PROPFIND /api/webdav/{path...}", s.wrap(bodyRaw, MaxRelayBodyBytes, false, s.handleRelay))
	s.mux.HandleFunc("PUT /api/webdav", s.wrap(bodyRaw, MaxRelayBodyBytes, false, s.handleRelay))
	s.mux.HandleFunc("PUT /api/webdav/{path...}", s.wrap(bodyRaw, MaxRelayBodyBytes, false, s.handleRelay))
	s.mux.HandleFunc("GET /api/webdav", s.wrap(bodyRaw, MaxRelayBodyBytes, false, s.handleRelay))
	s.mux.HandleFunc("GET /api/webdav/{path...}", s.wrap(bodyRaw, MaxRelayBodyBytes, false, s.handleRelay))
	s.mux.HandleFunc("DELETE /api/webdav", s.wrap(bodyRaw, MaxRelayBodyBytes, false, s.handleRelay))
	s.mux.HandleFunc("DELETE /api/webdav/{path...}", s.wrap(bodyRaw, MaxRelayBodyBytes, false, s.handleRelay))
	s.mux.HandleFunc("MKCOL /api/webdav", s.wrap(bodyRaw, MaxRelayBodyBytes, false, s.handleRelay))
	s.mux.HandleFunc("MKCOL /api/webdav/{path...}", s.wrap(bodyRaw, MaxRelayBodyBytes, false, s.handleRelay))
	// HEAD 由 GET 模式自动匹配；任意其它方法的 /api/webdav 走 405 回退。
	s.mux.HandleFunc("/api/webdav", s.wrap(bodyNone, 0, false, s.handleRelayMethodNotAllowed))
	s.mux.HandleFunc("/api/webdav/{path...}", s.wrap(bodyNone, 0, false, s.handleRelayMethodNotAllowed))

	s.mux.HandleFunc("GET /api/sync/config", s.wrap(bodyNone, 0, false, s.handleSyncConfigGet))
	s.mux.HandleFunc("PUT /api/sync/config", s.wrap(bodyJSON, MaxBodyBytes, false, s.handleSyncConfigPut))
	s.mux.HandleFunc("GET /api/sync/status", s.wrap(bodyNone, 0, false, s.handleSyncStatus))
	s.mux.HandleFunc("POST /api/sync/now", s.wrap(bodyNone, 0, false, s.handleSyncNow))
	s.mux.HandleFunc("POST /api/sync/upload", s.wrap(bodyNone, 0, false, s.handleSyncUpload))
	s.mux.HandleFunc("GET /api/sync/files", s.wrap(bodyNone, 0, false, s.handleSyncFiles))
	s.mux.HandleFunc("POST /api/sync/restore", s.wrap(bodyJSON, MaxBodyBytes, false, s.handleSyncRestore))
	s.mux.HandleFunc("DELETE /api/sync/files/{name}", s.wrap(bodyNone, 0, false, s.handleSyncDeleteFile))

	// 兜底：dispatch 未命中一律 404（与旧实现一致）。
	s.mux.HandleFunc("/api/", s.wrap(bodyNone, 0, true, func(*Context) (Response, error) {
		return Response{Status: 404, Body: map[string]any{"error": "not_found"}}, nil
	}))
}
