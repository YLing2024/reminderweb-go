# 路由逐请求对照清单（旧 Node 实现 vs 新 Go 实现）

权威源是旧实现 `/root/proj/ReminderWeb/server/src/http.ts`（只读，不修改）。
本文件记录新实现 `internal/httpapi` 与旧实现 `dispatch` 在「未注册路由 / 未支持动词」等
所有 (方法, 路径) 组合上的状态码对齐结果。

## 1. 口径与复现

- 路由只按 **「方法 + 路径」精确匹配**；未命中一律 `404 {"error":"not_found"}`。
- 处理次序（逐条对齐旧 `handleRequest`）：`OPTIONS /api/*` → 读体（含 413 / 400）→ 鉴权 → 分发。
- 复现工具：`tools/route-parity.mjs`（对两个 base 发同一批请求，逐条比对状态码与错误码）。

```bash
# 旧实现（只读参考；一次性 DATA_DIR 与空闲端口）
cd /root/proj/ReminderWeb && PORT=19555 AUTH_MODE=none SERVE_STATIC=0 DATA_DIR=/tmp/olddata node server/src/index.ts
# 新实现（一次性 MySQL：起一个临时容器，或指向手边的空库）
cd /root/proj/reminderweb-go && PORT=19557 AUTH_MODE=none SERVE_STATIC=0 \
  DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME=rwparity DB_USER=root DB_PASSWORD=… ./reminderweb-go
# 对照
node tools/route-parity.mjs --old http://127.0.0.1:19555 --new http://127.0.0.1:19557
# → 核对 234 个请求，差异 0 个
```

下面的矩阵即用上法捕获（`AUTH_MODE=none`，无请求体；此时所有请求都视为已认证）。
单元格 = `状态码` 或 `状态码 错误码`；`HEAD` 无响应体，只记状态码。

## 2. 完整矩阵（新实现与旧实现逐格一致）

<!-- matrix:start -->
| 路径 | GET | HEAD | POST | PUT | PATCH | DELETE | OPTIONS | PROPFIND | MKCOL |
|---|---|---|---|---|---|---|---|---|---|
| `/api/health` | 200 | 404 | 404 not_found | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/version` | 200 | 404 | 404 not_found | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/auth/login` | 404 not_found | 404 | 400 login_not_available | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/auth/logout` | 404 not_found | 404 | 200 | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/auth/me` | 200 | 404 | 404 not_found | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/data` | 200 | 404 | 404 not_found | 200 | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/data/full` | 200 | 404 | 404 not_found | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/data/replace` | 404 not_found | 404 | 404 not_found | 400 invalid_request | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/data/` | 404 not_found | 404 | 404 not_found | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/images/card-bg-1.jpg` | 404 not_found | 404 | 404 not_found | 400 empty_image | 404 not_found | 200 | 204 | 404 not_found | 404 not_found |
| `/api/images/` | 400 invalid_name | 404 | 404 not_found | 400 invalid_name | 404 not_found | 400 invalid_name | 204 | 404 not_found | 404 not_found |
| `/api/images` | 404 not_found | 404 | 404 not_found | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/webdav` | 400 missing_target | 400 | 405 method_not_allowed | 400 missing_target | 405 method_not_allowed | 400 missing_target | 204 | 400 missing_target | 400 missing_target |
| `/api/webdav/foo` | 400 missing_target | 400 | 405 method_not_allowed | 400 missing_target | 405 method_not_allowed | 400 missing_target | 204 | 400 missing_target | 400 missing_target |
| `/api/webdav/config` | 200 | 400 | 405 method_not_allowed | 400 invalid_config | 405 method_not_allowed | 400 missing_target | 204 | 400 missing_target | 400 missing_target |
| `/api/sync/config` | 200 | 404 | 404 not_found | 400 invalid_config | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/sync/status` | 200 | 404 | 404 not_found | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/sync/now` | 404 not_found | 404 | 200 | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/sync/upload` | 404 not_found | 404 | 500 internal_error | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/sync/files` | 500 internal_error | 404 | 404 not_found | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/sync/restore` | 404 not_found | 404 | 400 invalid_name | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/sync/files/x.zip` | 404 not_found | 404 | 404 not_found | 404 not_found | 404 not_found | 400 invalid_name | 204 | 404 not_found | 404 not_found |
| `/api/unknown` | 404 not_found | 404 | 404 not_found | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/` | 404 not_found | 404 | 404 not_found | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/data/unknown` | 404 not_found | 404 | 404 not_found | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
| `/api/health/extra` | 404 not_found | 404 | 404 not_found | 404 not_found | 404 not_found | 404 not_found | 204 | 404 not_found | 404 not_found |
<!-- matrix:end -->

说明：

- `/api/sync/upload`、`/api/sync/files` 的 `500 internal_error` 是「未配置可用 WebDAV」时旧实现的
  真实行为，两边一致，不是路由差异。
- `/api/auth/login` 在 `AUTH_MODE ≠ builtin` 时返回 `400 login_not_available`，与旧实现一致
  （需求书文字写「404」，此处以旧实现为功能权威）。
- `/api/webdav/config` 的 `HEAD`/`DELETE`/`PROPFIND`/`MKCOL` 落到转发路径：`HEAD` 是转发支持的动词，
  因缺 `X-Dav-Url` 返回 `400 missing_target`；`POST`/`PATCH` 未支持 → `405 method_not_allowed`。

## 3. 鉴权次序（`AUTH_MODE=builtin`，未带会话）

| 请求 | 旧 | 新 | 说明 |
|---|---|---|---|
| `GET /api/health` | 200 | 200 | 公开端点。|
| `POST /api/auth/login` | 200/400 | 200/400 | 公开端点。|
| `GET /api/version` | 401 unauthorized | 401 unauthorized | **非**公开端点。|
| `GET /api/unknown` | 401 unauthorized | 401 unauthorized | 未注册路径也要先鉴权。|
| `HEAD /api/unknown` | 401 | 401 | 同上。|
| `POST /api/unknown`（坏 JSON） | 400 invalid_json | 400 invalid_json | 读体先于鉴权。|
| `PUT /api/data`（坏 JSON） | 400 invalid_json | 400 invalid_json | 读体先于鉴权。|
| `POST /api/webdav`（坏 JSON） | 401 unauthorized | 401 unauthorized | 转发读原始体，不解析 JSON，随后未认证。|

## 4. 本轮对齐掉的差异（旧实现为准）

| # | 请求 | 修复前（新） | 修复后（新） | 旧实现 |
|---|---|---|---|---|
| 1 | `HEAD /api/health` 等所有 `GET` 路由 | 200（ServeMux 的 GET 模式误配 HEAD） | 404 not_found | 404 not_found |
| 2 | `HEAD /api/webdav/config` | 200（误落配置读处理器） | 400 missing_target | 400 missing_target |
| 3 | `GET /api/version`（未认证） | 200（被当作公开端点） | 401 unauthorized | 401 unauthorized |
| 4 | `GET /api/unknown`（未认证） | 404 not_found | 401 unauthorized | 401 unauthorized |
| 5 | `POST /api/unknown`（坏 JSON，未认证） | 404 not_found | 400 invalid_json | 400 invalid_json |
| 6 | `GET/PUT/DELETE /api/images/`（空名） | 404 not_found | 400 invalid_name | 400 invalid_name |
| 7 | `DELETE /api/sync/files/x.zip` | 409 sync_in_progress | 400 invalid_name | 400 invalid_name |
| 8 | 未设置 `PORT` 时的默认端口 | 19240 | 18940 | 18940 |

实现要点：`internal/httpapi` 不再依赖 Go 1.22 `ServeMux` 的方法模式推断，改为
`routes.go` 的有序路由表 + `api.go` 的 `dispatch` 精确匹配，从而消除「GET 自动匹配 HEAD」
「路径命中但方法不符返回 405」「尾斜杠重定向」等与旧实现不同的行为。

## 5. 仍存在的差异

路由层：**无**。`tools/route-parity.mjs` 对上述 234 个请求比对为 0 差异；
矩阵之外的抽样（`/api/images/x/y`、`/api/webdav/config/`、`/api/data//full`、
已编码路径 `/api/%64ata`、`/api/data%2Ffull` 等）也逐条一致。

静态托管缓存头：**已对齐（已消除）**。旧 `http.ts` 的 `serveStatic`（第 259 行）只按
`segments.length === 0` 区分缓存，未给 `index.html` 设特例：直接命中的静态文件（含显式请求的
`GET /index.html`）为 `public, max-age=3600`，只有 SPA 回退到 `index.html`（第 275 行）与目录根
`/` 为 `no-cache`。新实现原有一条 `name == "index.html" → no-cache` 的特例，现已删除。

| 请求 | 旧实测 | 新（修复前） | 新（修复后） |
|---|---|---|---|
| `GET /index.html` | `public, max-age=3600` | `no-cache` | `public, max-age=3600` |
| `GET /`（SPA 回退） | `no-cache` | `no-cache` | `no-cache` |
| `GET /sw.js`、`/assets/*` 等 | `public, max-age=3600` | `public, max-age=3600` | `public, max-age=3600` |

回归见 `internal/httpapi/api_test.go` 的 `TestIndexHTMLCacheControl` 与 `TestStaticServingAndFallback`。

其它层面：`CGO_ENABLED=0` 静态构建属打包方式差异，不改变 HTTP 响应；备份包不含墓碑、sso 登录
返回 `400 login_not_available` 等经复核均为旧实现本身的行为（非新旧差异），已从「差异」清单更正。
详见 [`ACCEPTANCE.md`](ACCEPTANCE.md)。
