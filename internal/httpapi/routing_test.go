package httpapi

import (
	"net/http"
	"testing"
)

// TestRouteTableParity 表驱动核对「未注册路由 / 未支持动词」的状态码与错误码，
// 逐条对齐旧 server/src/http.ts 的 dispatch：
//   - 只按「方法 + 路径」精确匹配，未命中一律 404 not_found；
//   - HEAD 不因 Go 的 GET 模式而误配 GET 处理器；
//   - /api/webdav 与 /api/webdav/* 的转发动词由转发器判定，未支持者 405。
//
// 其中关于 /api/webdav/config 的几条（HEAD / POST / PATCH / DELETE）与旧实现
// 逐条实测复核过：旧 dispatch 的转发判定是 `path.startsWith('/api/webdav/')`，
// 并未排除 config，因此这些动词并不落到配置读处理器，也不返回 404，而是进入转发器：
// HEAD / DELETE（均属 RELAY_METHODS）缺 X-Dav-Url → 400 missing_target；
// POST / PATCH（不在 RELAY_METHODS）→ 405 method_not_allowed。
func TestRouteTableParity(t *testing.T) {
	server, _ := testServer(t, map[string]string{"AUTH_MODE": "none"}, nil)
	handler := server.Handler()

	cases := []struct {
		name       string
		method     string
		path       string
		body       string
		wantStatus int
		wantCode   string
	}{
		// 未注册路径（含带斜杠 / 多段 / 前缀近似但不命中的路径）。
		{"未知路径", http.MethodGet, "/api/unknown", "", 404, "not_found"},
		{"根 api", http.MethodGet, "/api/", "", 404, "not_found"},
		{"多余段", http.MethodGet, "/api/health/extra", "", 404, "not_found"},
		{"路径尾斜杠", http.MethodGet, "/api/data/", "", 404, "not_found"},
		{"带扩展名的未注册段", http.MethodGet, "/api/data/unknown", "", 404, "not_found"},
		{"纯方法未知", "PROPFIND", "/api/nope", "", 404, "not_found"},

		// HEAD：不匹配任何 GET 处理器（旧实现精确匹配 HEAD，只会命中转发）。
		{"HEAD health", http.MethodHead, "/api/health", "", 404, "not_found"},
		{"HEAD version", http.MethodHead, "/api/version", "", 404, "not_found"},
		{"HEAD data", http.MethodHead, "/api/data", "", 404, "not_found"},
		{"HEAD data full", http.MethodHead, "/api/data/full", "", 404, "not_found"},
		{"HEAD auth me", http.MethodHead, "/api/auth/me", "", 404, "not_found"},
		{"HEAD sync config", http.MethodHead, "/api/sync/config", "", 404, "not_found"},
		{"HEAD sync files", http.MethodHead, "/api/sync/files", "", 404, "not_found"},
		{"HEAD image", http.MethodHead, "/api/images/card-bg-1.jpg", "", 404, "not_found"},
		{"HEAD 未知", http.MethodHead, "/api/unknown", "", 404, "not_found"},
		// HEAD 在转发路径上被旧实现放行：缺目标头 → 400。
		{"HEAD webdav", http.MethodHead, "/api/webdav", "", 400, "missing_target"},
		{"HEAD webdav 子路径", http.MethodHead, "/api/webdav/foo", "", 400, "missing_target"},
		// config 也被 startsWith 判为转发路径（旧实现未排除），故同样 400，而非落到配置读处理器。
		{"HEAD webdav config", http.MethodHead, "/api/webdav/config", "", 400, "missing_target"},

		// 未支持动词：GET 专用路由回 404（不是 405）。
		{"POST health", http.MethodPost, "/api/health", "", 404, "not_found"},
		{"PUT health", http.MethodPut, "/api/health", "", 404, "not_found"},
		{"PATCH version", http.MethodPatch, "/api/version", "", 404, "not_found"},
		{"DELETE data", http.MethodDelete, "/api/data", "", 404, "not_found"},
		{"PATCH data", http.MethodPatch, "/api/data", "", 404, "not_found"},
		{"POST data full", http.MethodPost, "/api/data/full", "", 404, "not_found"},
		{"PUT sync files", http.MethodPut, "/api/sync/files", "", 404, "not_found"},
		{"POST sync status", http.MethodPost, "/api/sync/status", "", 404, "not_found"},
		{"DELETE sync config", http.MethodDelete, "/api/sync/config", "", 404, "not_found"},

		// 图片：只认 PUT/GET/DELETE，其余动词 404；空名 / 多段名按非法名 400。
		{"POST image", http.MethodPost, "/api/images/x.jpg", "", 404, "not_found"},
		{"PATCH image", http.MethodPatch, "/api/images/x.jpg", "", 404, "not_found"},
		{"GET 空图片名", http.MethodGet, "/api/images/", "", 400, "invalid_name"},
		{"PUT 空图片名", http.MethodPut, "/api/images/", "", 400, "invalid_name"},
		{"DELETE 空图片名", http.MethodDelete, "/api/images/", "", 400, "invalid_name"},
		{"GET 多段图片名", http.MethodGet, "/api/images/x/y", "", 400, "invalid_name"},
		{"GET images 无斜杠", http.MethodGet, "/api/images", "", 404, "not_found"},

		// WebDAV 转发：未支持动词 405；支持动词缺目标头 400。
		{"POST webdav", http.MethodPost, "/api/webdav", "", 405, "method_not_allowed"},
		{"PATCH webdav", http.MethodPatch, "/api/webdav", "", 405, "method_not_allowed"},
		{"POST webdav 子路径", http.MethodPost, "/api/webdav/foo", "", 405, "method_not_allowed"},
		{"DELETE webdav 子路径", http.MethodDelete, "/api/webdav/foo", "", 400, "missing_target"},
		{"GET webdav", http.MethodGet, "/api/webdav", "", 400, "missing_target"},
		{"PROPFIND webdav", "PROPFIND", "/api/webdav", "", 400, "missing_target"},
		{"MKCOL webdav 子路径", "MKCOL", "/api/webdav/foo", "", 400, "missing_target"},

		// /api/webdav/config 是普通 JSON 设置接口，但旧实现只在转发体内排除 config；
		// 方法不在 GET/PUT 且非 RELAY_METHODS 时走转发器，故 POST/PATCH → 405、DELETE → 400。
		{"POST webdav config", http.MethodPost, "/api/webdav/config", "", 405, "method_not_allowed"},
		{"PATCH webdav config", http.MethodPatch, "/api/webdav/config", "", 405, "method_not_allowed"},
		{"DELETE webdav config", http.MethodDelete, "/api/webdav/config", "", 400, "missing_target"},
		{"POST webdav config 尾斜杠", http.MethodPost, "/api/webdav/config/", "", 405, "method_not_allowed"},
		{"GET webdav config 尾斜杠", http.MethodGet, "/api/webdav/config/", "", 400, "missing_target"},

		// 已注册 (方法, 路径) 必须仍命中（防止过度兜底）。
		{"GET health", http.MethodGet, "/api/health", "", 200, ""},
		{"GET webdav config", http.MethodGet, "/api/webdav/config", "", 200, ""},
		{"PUT webdav config 有效改动", http.MethodPut, "/api/webdav/config", `{"webdavKeep":20}`, 200, ""},
		{"OPTIONS 预检", http.MethodOptions, "/api/data", "", 204, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := do(t, handler, tc.method, tc.path, tc.body, map[string]string{"Content-Type": "application/json"})
			if rec.Code != tc.wantStatus {
				t.Fatalf("%s %s 状态码 = %d，期望 %d（体：%s）", tc.method, tc.path, rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.wantCode != "" {
				if code := decode(t, rec)["error"]; code != tc.wantCode {
					t.Fatalf("%s %s 错误码 = %v，期望 %s", tc.method, tc.path, code, tc.wantCode)
				}
			}
		})
	}
}

// TestUnmatchedRouteAuthOrdering 核对旧 handleRequest 的处理次序：
// 先读体（JSON 解析失败 400）→ 再鉴权（未认证 401）→ 最后未命中 404。
func TestUnmatchedRouteAuthOrdering(t *testing.T) {
	server, _ := testServer(t, map[string]string{"AUTH_MODE": "builtin"}, nil)
	handler := server.Handler()

	cases := []struct {
		name       string
		method     string
		path       string
		body       string
		wantStatus int
		wantCode   string
	}{
		{"公开健康检查", http.MethodGet, "/api/health", "", 200, ""},
		{"版本需认证", http.MethodGet, "/api/version", "", 401, "unauthorized"},
		{"未注册路由需认证", http.MethodGet, "/api/unknown", "", 401, "unauthorized"},
		{"未认证读库", http.MethodGet, "/api/data", "", 401, "unauthorized"},
		{"HEAD 未注册需认证", http.MethodHead, "/api/unknown", "", 401, "unauthorized"},
		// 读体先于鉴权：坏 JSON 在未认证时也先返回 400。
		{"未认证坏 JSON", http.MethodPost, "/api/unknown", "{bad", 400, "invalid_json"},
		{"未认证坏 JSON 已注册", http.MethodPut, "/api/data", "{bad", 400, "invalid_json"},
		// 转发为原始体，坏 JSON 不解析，随后因未认证返回 401。
		{"未认证转发坏体", http.MethodPost, "/api/webdav", "{bad", 401, "unauthorized"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := do(t, handler, tc.method, tc.path, tc.body, map[string]string{"Content-Type": "application/json"})
			if rec.Code != tc.wantStatus {
				t.Fatalf("%s %s 状态码 = %d，期望 %d（体：%s）", tc.method, tc.path, rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.wantCode != "" {
				if code := decode(t, rec)["error"]; code != tc.wantCode {
					t.Fatalf("%s %s 错误码 = %v，期望 %s", tc.method, tc.path, code, tc.wantCode)
				}
			}
		})
	}
}
