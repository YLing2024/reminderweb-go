# Go 重写与旧 Node 实现的 API 路由对照

本文把旧实现（`/root/proj/ReminderWeb/server/src/http.ts` 的 `dispatch`）注册的每一组
「方法 + 路径」逐条与新实现（`internal/httpapi/routes.go` 的 `routeTable` 与 `dispatch`）对照，
记录双方状态码、是否一致，以及不一致项的处理。

## 权威来源与匹配语义

旧 `dispatch` 只按「方法 + 路径」精确匹配，任何未命中一律 `404 {"error":"not_found"}`。
它不是路径路由器，而是若干条 `if` 顺序判断，关键语义：

- 精确条目：`GET /api/data` 只有在 `HEAD /api/data` 之外的方法才命中；`HEAD` 不会落到 `GET`。
- 图片前缀：`path.startsWith('/api/images/')`，再按 `PUT`/`GET`/`DELETE` 分派，其余动词落到末尾 `404`。
- 转发前缀：`path === '/api/webdav' || path.startsWith('/api/webdav/')` 一律交给 `handleWebDavRelay`；
  **该判定并未排除 `/api/webdav/config`**（`isRelayPath` 排除 config 只用于请求体读取与上限）。
  转发动词白名单 `RELAY_METHODS = {PROPFIND, PUT, GET, HEAD, DELETE, MKCOL}`；
  不在白名单 → `405 method_not_allowed`；缺 `X-Dav-Url` → `400 missing_target`。
- 同步删除前缀：`DELETE` + `path.startsWith('/api/sync/files/')`。
- 预检 `OPTIONS /api/*` 在 `dispatch` 之前处理，固定 `204`。
- 其余任意 `(方法, 路径)` → `404 not_found`。

新实现把上述语义固化为 `routeTable()` 的精确条目 + 前缀条目，按注册顺序线性匹配
（`matchRoute`），完全不使用 `ServeMux` 的方法推断，因此 `HEAD` 不会被 `GET` 模式吞掉。

## 取证方法

新、旧两个临时实例同时启动，对同一 `(方法, 路径)` 矩阵发请求，比对状态码与错误码：

- 新版：`go build` 出的临时二进制，`PORT=19252`，`DATA_DIR` 临时目录。
- 旧版：`/root/.nvm/versions/node/v24.19.0/bin/node server/src/index.ts`，`PORT=19251`，`DATA_DIR` 临时目录。
- 两边均 `AUTH_MODE=sso`、`AUTH_USER=linden`，请求带 `X-Auth-User: linden`。
- 全程只监听回环，未触碰 `18940` / `19240`，未动 systemd 与 nginx；取证结束即停两个临时实例。

矩阵覆盖 `GET/PUT/POST/PATCH/DELETE/HEAD/PROPFIND/MKCOL/OPTIONS` 九种动词与各类命中/未命中路径
（留存两次取证共 77 次请求、72 个不同的「方法 + 路径」组合），
**状态码与错误码逐条一致，差异为 0**。对应回归固定在 `internal/httpapi/routing_test.go`。
下面表格的状态码取自该次实测（已鉴权、带常规请求体的代表值）。

## 逐路由对照表

| 旧实现注册（方法 + 路径） | 旧状态码 | 新状态码 | 一致 | 备注 |
| --- | --- | --- | --- | --- |
| `GET /api/health` | 200 | 200 | 是 | 公开路由，不解析身份 |
| `GET /api/version` | 200 | 200 | 是 | |
| `POST /api/auth/login` | 400 | 400 | 是 | sso 模式下 `login_not_available` |
| `POST /api/auth/logout` | 200 | 200 | 是 | |
| `GET /api/auth/me` | 200 | 200 | 是 | |
| `GET /api/data` | 200 | 200 | 是 | |
| `GET /api/data/full` | 200 | 200 | 是 | |
| `PUT /api/data` | 200 | 200 | 是 | |
| `PUT /api/data/replace` | 400 | 400 | 是 | 缺 `reminders` → `invalid_request` |
| `PUT /api/images/{name}` | 200 | 200 | 是 | |
| `GET /api/images/{name}` | 404 | 404 | 是 | 文件不存在（名合法） |
| `DELETE /api/images/{name}` | 200 | 200 | 是 | |
| `GET /api/webdav/config` | 200 | 200 | 是 | 普通 JSON 设置接口 |
| `PUT /api/webdav/config` | 200 / 400 | 200 / 400 | 是 | 有改动字段 200；空 patch → `invalid_config` |
| `PROPFIND /api/webdav`、`/api/webdav/{path...}` | 400 | 400 | 是 | 缺 `X-Dav-Url` → `missing_target` |
| `PUT /api/webdav`、`/api/webdav/{path...}` | 400 | 400 | 是 | 同上 |
| `GET /api/webdav`、`/api/webdav/{path...}` | 400 | 400 | 是 | 同上 |
| `HEAD /api/webdav`、`/api/webdav/{path...}` | 400 | 400 | 是 | HEAD 属转发白名单 |
| `DELETE /api/webdav`、`/api/webdav/{path...}` | 400 | 400 | 是 | 同上 |
| `MKCOL /api/webdav`、`/api/webdav/{path...}` | 400 | 400 | 是 | 同上 |
| `POST /api/webdav`、`/api/webdav/{path...}` | 405 | 405 | 是 | 不在转发白名单 |
| `PATCH /api/webdav`、`/api/webdav/{path...}` | 405 | 405 | 是 | 同上 |
| `GET /api/sync/config` | 200 | 200 | 是 | |
| `PUT /api/sync/config` | 400 | 400 | 是 | 空 patch → `invalid_config` |
| `GET /api/sync/status` | 200 | 200 | 是 | |
| `POST /api/sync/now` | 200 | 200 | 是 | |
| `POST /api/sync/upload` | 500 | 500 | 是 | 未配置 WebDAV 时的处理器分支，非路由差异 |
| `GET /api/sync/files` | 500 | 500 | 是 | 同上（`ListFiles` 依赖 WebDAV） |
| `POST /api/sync/restore` | 400 | 400 | 是 | 缺备份名 → `invalid_name` |
| `DELETE /api/sync/files/{name}` | 400 | 400 | 是 | 名非法 → `invalid_name` |
| `OPTIONS /api/*`（任意已注册或未注册路径） | 204 | 204 | 是 | 预检，在分发前处理 |
| 任意其它 `(方法, 路径)`（含 `HEAD` 打精确 GET 路由、`GET /api/data/`、`GET /api/`、`GET /api/sync/files/{name}`、`POST /api/data`、`DELETE /api/data`） | 404 | 404 | 是 | `not_found` |
| 前缀近似但不命中：`GET /api/images`（无斜杠）、`GET /api/images/x/y` | 404 / 400 | 404 / 400 | 是 | 无斜杠不算图片前缀；多段名 → `invalid_name` |

## 关于 `/api/webdav/config` 非 GET/PUT 动词的专项说明

任务书预期的「`HEAD /api/webdav/config` 与 `POST/PATCH/DELETE /api/webdav/config` 一律 `404 not_found`」
与实际旧实现不符，已实测复核：

| 方法 + `/api/webdav/config` | 旧实测 | 新实测 | 一致 |
| --- | --- | --- | --- |
| `HEAD` | 400 `missing_target` | 400 `missing_target` | 是 |
| `POST` | 405 `method_not_allowed` | 405 `method_not_allowed` | 是 |
| `PATCH` | 405 `method_not_allowed` | 405 `method_not_allowed` | 是 |
| `DELETE` | 400 `missing_target` | 400 `missing_target` | 是 |

原因：旧 `dispatch` 第 306 行用 `path.startsWith('/api/webdav/')` 判定转发，**没有排除 `config`**，
所以这些方法进入 `handleWebDavRelay`，而非落到 `handleRelayConfigGet`（`GET`）或 `handleRelayConfigPut`（`PUT`）。
它们既不会命中配置读处理器（也不返回 200），也不会是 `404`。因此新实现保持与旧实现一致的 `400`/`405`，
不引入 `404` 偏差；任务书该条预期的修正以本节为准。

## 结论

- 已对照的各组 `(方法, 路径)` 状态码 **全部一致**，无残留不一致项。
- 唯一与任务书文字预期冲突的点是 `/api/webdav/config` 的 `HEAD/POST/PATCH/DELETE`：实测旧实现为
  `400/405/405/400`，新实现逐条一致；任务书所述的 `404` 系对旧 `dispatch` 的误读，未采纳。
- 回归用例见 `internal/httpapi/routing_test.go`（`TestRouteTableParity`、`TestUnmatchedRouteAuthOrdering`）。
