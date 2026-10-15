# ReminderWeb 后端 API（权威契约）

本文件是 reminderweb-go 后端 HTTP 接口的权威契约。**改了路由不改本文件 = 未完成**：
路由在 `internal/httpapi/routes.go` 的 `routeTable` 里以 `{pattern: "METHOD /path", ...}` 字面量登记，
`scripts/check-api-docs.mjs` 会机检「源码登记 ↔ 本文 `### METHOD /path` 标题」一致，并随 `make check` 一起跑。

- 统一前缀：`/api`。
- 请求 / 响应体一律 UTF-8 JSON（图片上传与 WebDAV 中继为原始字节）。
- 默认监听 `127.0.0.1:18940`（与旧 Node 实现一致；显式设置 `PORT` 时以环境变量为准，生产部署用 `PORT=19240`），
  对外由 nginx 反代。示例统一用 `127.0.0.1` / `example.com`。
- 路由按「方法 + 路径」精确匹配（对齐旧实现 `dispatch`），未命中一律 `404 {"error":"not_found"}`；
  文档里的 `{name}` / `{path...}` 只是路径参数占位，匹配语义见 §5。

## 1. 认证模式

由环境变量 `AUTH_MODE` 决定，三种取值：

| 模式 | 身份来源 | 说明 |
|---|---|---|
| `builtin`（默认） | 会话 Cookie `__Host-rw_session` | 口令经 scrypt 加盐校验；登录成功下发会话 Cookie。|
| `sso` | 请求头 `X-Auth-User` | 只信任前置 Auth Gateway 注入的用户名；自带登录入口返回 `login_not_available`。|
| `none` | 无 | 仅本机开发；所有请求视为用户 `dev`。生产禁用。|

- 会话 Cookie：`__Host-rw_session=<token>; Path=/; HttpOnly; Secure; SameSite=Lax|None; Max-Age=<秒>`。
  `__Host-` 前缀要求 `Secure` 且不带 `Domain`。令牌为 32 字节随机数的 base64url，数据库只存其 SHA-256 十六进制摘要。
- 会话有效期 `SESSION_TTL_DAYS`（默认 30 天）。过期会话在下一次校验时删除并判为未认证。
- 跨站部署（前后端分离）时用 `ALLOWED_ORIGINS` + `COOKIE_SAME_SITE=none`。
- 登录失败限流：每 IP 10 分钟窗口内失败次数超过 `LOGIN_RATE_LIMIT`（默认 5）后返回 `429`；
  失败固定延迟 150 ms 以抵御时间侧信道。
- **公开端点**（无需身份）：`GET /api/health`、`POST /api/auth/login`。其余端点（含 `GET /api/version`）未认证一律 `401 unauthorized`。

## 2. 数据模型约定

同步层在条目上额外携带 `updatedAt`（epoch 毫秒，用于条目级合并）；`updatedAt` **不进备份包**，仅用于服务端同步。

### ReminderItem（提醒）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | 整数（>0） | 主键，提醒与标签各自独立 id 空间。JSON 中为数字。|
| `title` | string | 标题。|
| `date` | string | 起始日期 `YYYY-MM-DD`。|
| `endDate` | string \| null | 结束日期。|
| `type` | `ANNUAL` \| `COUNT_UP` \| `BIRTHDAY` | 事件类型。|
| `isLunar` | boolean | 是否农历。|
| `tag` | string | 标签名（空串表示无标签）。|
| `isPinned` | boolean | 是否置顶。|
| `repeatInfo` | object \| null | `{interval:int, unit:DAY\|WEEK\|MONTH\|YEAR, endDate:string\|null}`。|
| `notificationConfig` | object | 通知配置。|
| `notes` | string | 备注。|
| 其余 `cardBackground*` / `custom*` 字段 | — | 与安卓端逐字对齐的样式参数，服务端**原样透传**，未知字段不丢。|
| `updatedAt` | 整数（>=0） | 同步元数据：最后修改时间（epoch 毫秒）。|

### TagItem（标签）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | 整数（>0） | 主键。|
| `name` | string | 标签名。|
| `color` | string | 颜色，如 `#2196F3`。|
| `sortOrder` | number | 排序值。|
| `updatedAt` | 整数（>=0） | 同步元数据。|

### Tombstone（删除标记）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | 整数（>0） | 被删除条目的 id。|
| `updatedAt` | 整数（>=0） | 删除时间（epoch 毫秒）。|
| `kind` | `reminder` \| `tag` | 条目种类；缺省按 `reminder`。|

### SettingsEnvelope（设置信封）

`{ "value": {…}, "updatedAt": <毫秒> }`。整份设置作为一个原子条目按 `updatedAt` 比较更新。

### 校验与容错（`PUT /api/data`、`PUT /api/data/replace`）

- 条目解析统一用整数精度（不经过 float64）。
- `reminders` / `tags` / `tombstones` 缺省视为 `[]`；非数组或坏条目不计入结果，而是累加到响应里的 `rejected` 计数。
- `settings` 缺省表示不改动设置；`updatedAt` 缺失或非法时按落库时间补齐（导入备份包路径用备份文件 mtime）。

## 3. 错误体与错误码

错误统一为 `{"error":"<code>"}`，部分带 `{"error":"<code>","message":"<中文说明>"}`。

| 错误码 | HTTP | 含义 |
|---|---|---|
| `unauthorized` | 401 | 未认证。|
| `invalid_credentials` | 401 | 用户名或口令错误。|
| `login_not_available` | 400 | 非 `builtin` 模式调用登录。|
| `too_many_requests` | 429 | 登录失败次数超限。|
| `invalid_request` | 400 | 请求体缺字段 / 结构不对。|
| `invalid_json` | 400 | 请求体不是合法 JSON。|
| `invalid_body` | 400 | 读取请求体失败。|
| `payload_too_large` | 413 | 请求体或图片超限。|
| `not_found` | 404 | 资源不存在（图片 / 云端备份 / 未命中路由）。|
| `invalid_name` | 400 | 图片名或备份文件名不合法。|
| `empty_image` | 400 | 图片内容为空。|
| `invalid_config` | 400 | WebDAV / 同步配置不合法。|
| `replace_failed` | 500 | 整库替换失败（已回滚）。|
| `missing_target` | 400 | 中继缺少 `X-Dav-Url`。|
| `target_not_allowed` | 403 | 中继目标被 SSRF 策略拒绝。|
| `method_not_allowed` | 405 | 中继不支持的动词。|
| `relay_failed` | 502 | 中继上游连接失败。|
| `sync_disabled` | 409 | 同步引擎不可用。|
| `sync_in_progress` | 409 | 已有同步任务在执行。|
| `sync_failed` | 502 | 同步 / 云端操作失败。|
| `invalid_backup` | 400 | 备份包无法解析。|
| `internal_error` | 500 | 未预期错误。|

### 请求体大小上限

| 范围 | 上限 |
|---|---|
| 默认（含 `PUT /api/data`、`/api/webdav/config`、`/api/sync/config`、`/api/sync/restore`）| 2 MiB |
| `PUT /api/data/replace` | 32 MiB |
| WebDAV 中继（`/api/webdav…`）| 64 MiB |

`PUT /api/images/{name}` 读取上限为默认 2 MiB，且图片字节另受 `MAX_IMAGE_BYTES`（8 MiB）约束。

---

## 4. 端点

### GET /api/health

公开。健康检查，返回当前 revision 与认证摘要。副作用：无。

```bash
curl -s http://127.0.0.1:19240/api/health
```

```json
{"ok":true,"revision":0,"authMode":"none","authWarning":false}
```

- `authWarning`：`builtin` 且口令仍是默认值（`changeme`）或长度 < 8 时为 `true`；不含口令本身。

### GET /api/version

需认证。返回服务标识与 schema 版本。副作用：无。

```bash
curl -s http://127.0.0.1:19240/api/version
```

```json
{"server":"reminderweb","version":"0.1.0","schemaVersion":1}
```

### POST /api/auth/login

公开。仅 `builtin` 模式可用。请求体：`username`（string，必填）、`password`（string，必填）。
成功下发会话 Cookie。副作用：写一条 `login` 审计记录。

```bash
curl -s -i -X POST http://127.0.0.1:19240/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"example-password"}'
```

```
HTTP/1.1 200 OK
Set-Cookie: __Host-rw_session=<token>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000

{"username":"admin"}
```

错误：`400 login_not_available`（非 builtin）、`400 invalid_request`（缺字段 / 空值）、`401 invalid_credentials`、`429 too_many_requests`。

### POST /api/auth/logout

需认证。删除当前会话并清 Cookie。副作用：删除会话行。

```bash
curl -s -X POST http://127.0.0.1:19240/api/auth/logout -b 'rwsession'
```

```json
{"ok":true}
```

### GET /api/auth/me

需认证。返回当前身份。

```bash
curl -s http://127.0.0.1:19240/api/auth/me -b 'rwsession'
```

```json
{"username":"admin","authMode":"builtin"}
```

未认证：`401 unauthorized`。

### GET /api/data

需认证。返回除图片字节外的全部数据。副作用：无。

```bash
curl -s http://127.0.0.1:19240/api/data -b 'rwsession'
```

```json
{
  "revision": 24,
  "reminders": [{"id":1,"title":"纪念日","date":"2026-01-01","type":"ANNUAL","updatedAt":1700000000000}],
  "tags": [{"id":1,"name":"家人","color":"#2196F3","sortOrder":0,"updatedAt":1700000000000}],
  "settings": {"value":{},"updatedAt":0},
  "tombstones": [],
  "imageNames": []
}
```

### GET /api/data/full

需认证。在 `GET /api/data` 基础上附带图片字节（base64）。副作用：无。

```bash
curl -s http://127.0.0.1:19240/api/data/full -b 'rwsession'
```

```json
{"revision":24,"reminders":[],"tags":[],"settings":{"value":{},"updatedAt":0},
 "tombstones":[],"imageNames":["card-bg-1.jpg"],
 "images":[{"name":"card-bg-1.jpg","data":"<base64>"}]}
```

### PUT /api/data

需认证。条目级合并（按 `updatedAt` / 墓碑）。请求体：

| 字段 | 位置 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|---|
| `baseRevision` | body | number | 否 | 0 | 客户端基线 revision（仅记录）。|
| `reminders` | body | array | 否 | `[]` | 提醒条目。|
| `tags` | body | array | 否 | `[]` | 标签条目。|
| `settings` | body | object | 否 | 无 | 设置信封。|
| `tombstones` | body | array | 否 | `[]` | 删除标记。|

副作用：有实际变更时 revision 自增；写审计 `put_data`；触发同步引擎 `MarkLocalChange`（自动同步开启时）。

```bash
curl -s -X PUT http://127.0.0.1:19240/api/data -b 'rwsession' \
  -H 'Content-Type: application/json' \
  -d '{"baseRevision":0,"reminders":[{"id":1,"title":"纪念日","date":"2026-01-01","type":"ANNUAL","updatedAt":1700000000000}],"tags":[],"tombstones":[]}'
```

```json
{"revision":1,"serverRevisionBefore":0,"baseRevision":0,"rejected":0,
 "reminders":[…],"tags":[],"settings":{"value":{},"updatedAt":0},"tombstones":[],"imageNames":[]}
```

### PUT /api/data/replace

需认证。整库覆盖式替换：先清空 reminders / tags / settings / images，再原样写入，最后 revision 自增一次；整体在一个事务里，失败回滚（不出现半库状态）。请求体：

| 字段 | 位置 | 类型 | 必填 | 默认 | 校验 |
|---|---|---|---|---|---|
| `reminders` | body | array | **是** | — | 必须是数组；缺失或非数组返回 `400 invalid_request`。|
| `tags` | body | array | 否 | `[]` | 必须是数组。|
| `settings` | body | object | 否 | 空信封 | 必须是设置信封。|
| `images` | body | array | 否 | `[]` | 每项 `{name,data}`，`data` 为 base64；单张 ≤ 8 MiB。|

副作用：revision 自增；写审计 `replace_data`；触发同步引擎 `MarkLocalChange`。

```bash
curl -s -X PUT http://127.0.0.1:19240/api/data/replace -b 'rwsession' \
  -H 'Content-Type: application/json' \
  -d '{"reminders":[{"id":7,"title":"替换后","date":"2026-02-02","type":"ANNUAL","updatedAt":1}],"tags":[],"images":[]}'
```

```json
{"revision":5,"serverRevisionBefore":4,"rejected":0,
 "counts":{"reminders":1,"tags":0,"images":0},
 "reminders":[…],"tags":[],"settings":{"value":{},"updatedAt":0},"tombstones":[],"imageNames":[]}
```

错误：`400 invalid_request`（不是对象 / 缺 `reminders`）、`500 replace_failed`（写入失败，数据未改动）、`413 payload_too_large`。

### PUT /api/images/{name}

需认证。原样上传一张图片字节（`Content-Type` 任意）。校验：`name` 合法、内容非空、≤ 8 MiB。

```bash
curl -s -X PUT http://127.0.0.1:19240/api/images/card-bg-1.jpg -b 'rwsession' \
  --data-binary @card.jpg
```

```json
{"ok":true,"name":"card-bg-1.jpg"}
```

错误：`400 invalid_name`、`400 empty_image`、`413 payload_too_large`。

### GET /api/images/{name}

需认证。返回原始字节，`Content-Type: application/octet-stream`。

```bash
curl -s http://127.0.0.1:19240/api/images/card-bg-1.jpg -b 'rwsession' -o card.jpg
```

错误：`400 invalid_name`、`404 not_found`。

### DELETE /api/images/{name}

需认证。删除一张图片（不存在也返回成功）。副作用：删除图片行。

```bash
curl -s -X DELETE http://127.0.0.1:19240/api/images/card-bg-1.jpg -b 'rwsession'
```

```json
{"ok":true}
```

错误：`400 invalid_name`。

### GET /api/webdav/config

需认证。返回服务器级 WebDAV 设置视图；**绝不含口令明文**，只给 `webdavPasswordSet` 布尔。

```bash
curl -s http://127.0.0.1:19240/api/webdav/config -b 'rwsession'
```

```json
{"relayAllowPrivate":false,"webdavEnabled":false,"webdavUrl":"","webdavUsername":"",
 "webdavPasswordSet":false,"webdavIntervalMinutes":30,"webdavKeep":10}
```

### PUT /api/webdav/config

需认证。部分更新（未出现的字段不改动）。字段与视图同名，另加 `webdavPassword`（string）。

- `webdavPassword` 缺省或空串 = 不改动；字面量 `__clear__` = 清空口令。
- `webdavIntervalMinutes` 范围 `1–1440`；`webdavKeep` 范围 `1–1000`；`webdavUrl` 需为 `http(s)://host…`。
- 启用前必须已有 `webdavUrl`。落库后立即重排同步定时器，无需重启。写审计 `webdav_config_update`（不含口令值）。

```bash
curl -s -X PUT http://127.0.0.1:19240/api/webdav/config -b 'rwsession' \
  -H 'Content-Type: application/json' \
  -d '{"webdavUrl":"https://dav.example.com/dav/","webdavUsername":"u","webdavPassword":"example-secret","webdavEnabled":true}'
```

```json
{"relayAllowPrivate":false,"webdavEnabled":true,"webdavUrl":"https://dav.example.com/dav/",
 "webdavUsername":"u","webdavPasswordSet":true,"webdavIntervalMinutes":30,"webdavKeep":10}
```

错误：`400 invalid_config`（含中文 `message`）。

### PROPFIND /api/webdav

### PROPFIND /api/webdav/{path...}

### PUT /api/webdav

### PUT /api/webdav/{path...}

### GET /api/webdav

### GET /api/webdav/{path...}

### DELETE /api/webdav

### DELETE /api/webdav/{path...}

### MKCOL /api/webdav

### MKCOL /api/webdav/{path...}

需认证。浏览器侧 WebDAV 中继：把请求原样转发到 `X-Dav-Url` 指向的上游，避免前端受 CORS 限制。

请求头：

| 头 | 必填 | 说明 |
|---|---|---|
| `X-Dav-Url` | 是 | 目标完整地址；缺失返回 `400 missing_target`。|
| `X-Dav-User` / `X-Dav-Password` | 否 | 拼 Basic 认证；仅转发、不落日志、不回显。|
| `Depth` / `Content-Type` / `If-Match` | 否 | 透传给上游。|

允许的动词：`PROPFIND`、`PUT`、`GET`、`HEAD`、`DELETE`、`MKCOL`。其它动词返回 `405 method_not_allowed`。

SSRF 策略（`internal/ssrf`）：默认拒绝指向回环 / 私网 / 链路本地 / 云元数据的字面量目标（`403 target_not_allowed`）；
设置页 `relayAllowPrivate` 为 `true` 时放行（用于局域网 NAS）。不自动跟随重定向。副作用：无落库。

```bash
curl -s -X PROPFIND http://127.0.0.1:19240/api/webdav -b 'rwsession' \
  -H 'X-Dav-Url: https://dav.example.com/dav/' -H 'X-Dav-User: u' -H 'X-Dav-Password: example-secret' \
  -H 'Depth: 1'
```

错误：`400 missing_target`、`403 target_not_allowed`、`405 method_not_allowed`、`502 relay_failed`。

### GET /api/sync/config

需认证。返回同步配置的兼容视图（间隔白名单 `5/10/30/60`，保留份数范围 `1–50`）。

```bash
curl -s http://127.0.0.1:19240/api/sync/config -b 'rwsession'
```

```json
{"enabled":false,"intervalMinutes":30,"keep":10,
 "options":{"intervals":[5,10,30,60],"keepRange":[1,50]},"url":""}
```

### PUT /api/sync/config

需认证。部分更新 `enabled`（bool）、`intervalMinutes`（`5|10|30|60`）、`keep`（`1–50`）。落库后立即重排定时器。

```bash
curl -s -X PUT http://127.0.0.1:19240/api/sync/config -b 'rwsession' \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true,"intervalMinutes":10,"keep":20}'
```

错误：`400 invalid_config`。

### GET /api/sync/status

需认证。返回同步引擎状态。副作用：无。

```bash
curl -s http://127.0.0.1:19240/api/sync/status -b 'rwsession'
```

```json
{"enabled":true,"url":"https://dav.example.com/dav/","lastSyncAt":null,"lastUploadAt":null,
 "lastResult":null,"lastError":null,"pendingChanges":false,"remoteFiles":[],
 "nextSyncAt":1730000000000,"lastMerged":0,"lastAction":"none"}
```

### POST /api/sync/now

需认证。立即执行一次双向同步。副作用：可能拉取并合并远端备份、上传新备份、清理本服务上传的旧包。

```bash
curl -s -X POST http://127.0.0.1:19240/api/sync/now -b 'rwsession'
```

返回同 `GET /api/sync/status` 的状态体。错误：`409 sync_in_progress`、`409 sync_disabled`。

### POST /api/sync/upload

需认证。只上传不拉取。

```bash
curl -s -X POST http://127.0.0.1:19240/api/sync/upload -b 'rwsession'
```

```json
{"name":"reminder-backup-20260101-120000.zip","size":12345,"lastUploadAt":1730000000000}
```

错误：`409 sync_in_progress`、`409 sync_disabled`、`502 sync_failed`。

### GET /api/sync/files

需认证。列出云端备份（时间倒序）。

```bash
curl -s http://127.0.0.1:19240/api/sync/files -b 'rwsession'
```

```json
{"files":[{"name":"reminder-backup-20260101-120000.zip","size":12345,"modifiedAt":1730000000000}]}
```

错误：`502 sync_failed`。

### POST /api/sync/restore

需认证。从指定远端备份恢复（合并式，**绝不删除远端文件**；重复恢复幂等）。请求体：`name`（string，必填，须匹配 `reminder-backup-yyyyMMdd-HHmmss.zip`）。

副作用：合并写库，有变更时 revision 自增；记录 `sync.lastAction=restore`。

```bash
curl -s -X POST http://127.0.0.1:19240/api/sync/restore -b 'rwsession' \
  -H 'Content-Type: application/json' \
  -d '{"name":"reminder-backup-20260101-120000.zip"}'
```

```json
{"applied":{"updated":3,"added":1,"removed":0,"rejected":0},"revision":42}
```

错误：`400 invalid_name`、`404 not_found`、`400 invalid_backup`、`409 sync_in_progress`、`409 sync_disabled`、`502 sync_failed`。

### DELETE /api/sync/files/{name}

需认证。删除云端指定备份；只删本应用命名的备份，绝不碰同目录其它文件。副作用：删除远端文件。

```bash
curl -s -X DELETE http://127.0.0.1:19240/api/sync/files/reminder-backup-20260101-120000.zip -b 'rwsession'
```

```json
{"ok":true}
```

错误：`400 invalid_name`、`404 not_found`、`409 sync_in_progress`、`409 sync_disabled`、`502 sync_failed`。

---

## 5. 未命中、动词与其它约定

以下规则逐条对齐旧 Node 实现（`server/src/http.ts` 的 `handleRequest` + `dispatch`），
完整逐路由对照见 [`ROUTE-PARITY.md`](ROUTE-PARITY.md)。

处理次序（对每个 `/api/*` 请求）：预检 → 读体 → 鉴权 → 分发。

- `OPTIONS /api/*` 一律 `204`（不受认证影响）。
- **读体先于鉴权**：`POST`/`PUT`/`PATCH` 会先解析 JSON，体超限 `413 payload_too_large`、解析失败
  `400 invalid_json`（未认证也一样）；`/api/webdav` 与 `/api/webdav/*` 读原始体（上限 64 MiB），不解析 JSON；
  `/api/images/` 上的 `PUT`/`POST` 读原始体（上限 2 MiB）。
- **只有 `GET /api/health` 与 `POST /api/auth/login` 免认证**；其余（含未注册路径）未认证一律 `401 unauthorized`。
- **精确匹配**：只按「方法 + 路径」字面量命中，未命中一律 `404 {"error":"not_found"}`。
  - `HEAD` 不匹配任何 `GET` 路由（`HEAD /api/health` 等一律 `404`）；仅 WebDAV 转发放行 `HEAD`。
  - 路径尾斜杠、多段、已编码字符（如 `/api/%64ata`）都不命中。
  - `GET/PUT /api/webdav/config` 之外的动词（`POST`/`PATCH`/…）落到转发路径：未支持动词 `405 method_not_allowed`，
    `DELETE`/`PROPFIND`/`MKCOL`/`HEAD` 等受支持动词因缺 `X-Dav-Url` 返回 `400 missing_target`。
- **`/api/images/`** 只认 `PUT` / `GET` / `DELETE`，其余动词 `404`；`/api/images/`（空名）或多段名 `400 invalid_name`。
- **`/api/webdav` 与 `/api/webdav/{path...}`** 的不支持动词返回 `405 method_not_allowed`；`HEAD` 属支持动词。
- **`DELETE /api/sync/files/{name}`** 的非法文件名返回 `400 invalid_name`（先判名，再判执行中）。
- 非 `/api/` 路径交给静态托管：`SERVE_STATIC=1`（默认）时返回前端产物，`SERVE_STATIC=0` 时返回 `404`；
  `STATIC_ONLY=1` 时只托管前端、`/api/*` 一律 `404`。
  - 静态响应缓存（对齐旧实现 `serveStatic`）：直接命中的产物（含显式请求 `GET /index.html`）为
    `Cache-Control: public, max-age=3600`；SPA 回退（未知无扩展名路径回落到 `index.html`）与目录根 `/`
    为 `no-cache`。两者都带 `X-Content-Type-Options: nosniff`。
