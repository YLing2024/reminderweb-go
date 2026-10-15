package httpapi

// routeTable 是全部 API 路由，按旧 server/src/http.ts 的 dispatch 顺序排列。
//
// pattern 既是匹配依据（方法 + 路径），也是 scripts/check-api-docs.mjs 与
// docs/API.md 机检对照的字面量锚点：任何一条（方法, 路径）都不许遗漏或改形。
// 不带方法前缀的 pattern（如转发兜底 "/api/webdav"）表示任意方法，机检自动忽略。
//
// 顺序即优先级：先精确条目，再前缀条目。图片只认 PUT/GET/DELETE，其余动词落到 404；
// WebDAV 转发的全部动词都交给 handleRelay，由它按 RELAY_METHODS 判定（未支持者 405）。
func (s *Server) routeTable() []apiRoute {
	return []apiRoute{
		{pattern: "GET /api/health", public: true, handler: s.handleHealth},
		{pattern: "GET /api/version", handler: s.handleVersion},

		{pattern: "POST /api/auth/login", public: true, handler: s.handleLogin},
		{pattern: "POST /api/auth/logout", handler: s.handleLogout},
		{pattern: "GET /api/auth/me", handler: s.handleMe},

		{pattern: "GET /api/data", handler: s.handleGetData},
		{pattern: "GET /api/data/full", handler: s.handleGetFullData},
		{pattern: "PUT /api/data", handler: s.handlePutData},
		{pattern: "PUT /api/data/replace", handler: s.handlePutReplace},

		{pattern: "PUT /api/images/{name}", prefixPath: "/api/images/", nameParam: "name", handler: s.handlePutImage},
		{pattern: "GET /api/images/{name}", prefixPath: "/api/images/", nameParam: "name", handler: s.handleGetImage},
		{pattern: "DELETE /api/images/{name}", prefixPath: "/api/images/", nameParam: "name", handler: s.handleDeleteImage},

		{pattern: "GET /api/webdav/config", handler: s.handleWebdavConfigGet},
		{pattern: "PUT /api/webdav/config", handler: s.handleWebdavConfigPut},

		// 转发：先登记支持的动词（供文档机检），再用「任意方法」兜底覆盖 HEAD 与其它动词。
		{pattern: "PROPFIND /api/webdav", handler: s.handleRelay},
		{pattern: "PROPFIND /api/webdav/{path...}", prefixPath: "/api/webdav/", handler: s.handleRelay},
		{pattern: "PUT /api/webdav", handler: s.handleRelay},
		{pattern: "PUT /api/webdav/{path...}", prefixPath: "/api/webdav/", handler: s.handleRelay},
		{pattern: "GET /api/webdav", handler: s.handleRelay},
		{pattern: "GET /api/webdav/{path...}", prefixPath: "/api/webdav/", handler: s.handleRelay},
		{pattern: "DELETE /api/webdav", handler: s.handleRelay},
		{pattern: "DELETE /api/webdav/{path...}", prefixPath: "/api/webdav/", handler: s.handleRelay},
		{pattern: "MKCOL /api/webdav", handler: s.handleRelay},
		{pattern: "MKCOL /api/webdav/{path...}", prefixPath: "/api/webdav/", handler: s.handleRelay},
		{pattern: "/api/webdav", handler: s.handleRelay},
		{pattern: "/api/webdav/{path...}", prefixPath: "/api/webdav/", handler: s.handleRelay},

		{pattern: "GET /api/sync/config", handler: s.handleSyncConfigGet},
		{pattern: "PUT /api/sync/config", handler: s.handleSyncConfigPut},
		{pattern: "GET /api/sync/status", handler: s.handleSyncStatus},
		{pattern: "POST /api/sync/now", handler: s.handleSyncNow},
		{pattern: "POST /api/sync/upload", handler: s.handleSyncUpload},
		{pattern: "GET /api/sync/files", handler: s.handleSyncFiles},
		{pattern: "POST /api/sync/restore", handler: s.handleSyncRestore},
		{pattern: "DELETE /api/sync/files/{name}", prefixPath: "/api/sync/files/", nameParam: "name", handler: s.handleSyncDeleteFile},
	}
}
