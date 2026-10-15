# 验收报告

> 存储口径变更（2026-10-16）：服务由 SQLite 单库改为 **仅 MySQL**，`DATA_DIR` 不复存在，
> 旧 SQLite 数据只经独立工具 `tools/migrate-sqlite-to-mysql` 一次性导入。本报告下述 HTTP 行为
> 与存储实现无关，§3–§9 的原始记录来自存储变更前的同一套 HTTP 代码；**§1 命令、§2、§10、§11
> 已按 MySQL 重新取证**。变更前后路由逐请求对照仍为 0 差异（见 §11 与 `ROUTE-PARITY.md`）。

需求书 §7 的 10 条验收逐条执行记录。所有命令均在隔离环境执行：只监听 `127.0.0.1:19240`
（同步/中继用到的隔离假 WebDAV 在 `127.0.0.1:19241/19243`），绝不触碰现网 `18940`。
验收工作目录：`/root/.hermes/cache/scratch/opencode/rw-acc/final/`；旧实现只读参考，
用 `tools/old-backup-*.mjs`、`tools/db-count.mjs` 以 `node:sqlite` 只读方式核对，未修改旧仓库。
存储相关用例另用自建脚手架 `.acceptance/`（不入库）：一次性 `mysql:8.4` 容器 +
迁移工具灌入旧库快照，见 §11。

被测二进制：`CGO_ENABLED=0 go build -trimpath -ldflags "-s -w"` 产物，静态链接，
`sha256=a3dc828137f775d5702be07b4a33e9aadc302131f856bccc380dfc459ca04fc9`（仅 MySQL 版）。

## 1. 构建与测试

```bash
go vet ./...                                        # 无输出
scripts/test-mysql.sh go test ./cmd/... ./internal/... ./tools/... -count=1
scripts/test-mysql.sh go test ./internal/... -count=1 -race
make check                                          # vet + 路由↔文档机检 + 单测（一次性 MySQL 容器）
cd tools/migrate-sqlite-to-mysql && go test ./...   # 迁移工具单测（独立 module）
```

`go vet` 零输出；`go test` 全绿；`-race` 全绿；`make check` 退出 0。单测跑在
`scripts/test-mysql.sh` 起的一次性 `mysql:8.4` 容器上（只绑 `127.0.0.1` 随机高位端口，结束即删除）。
前端：

```bash
cd web && npm run typecheck   # tsc -b，退出 0
cd web && npm run build       # vite build，退出 0
```

## 2. 旧库经迁移工具导入 MySQL 后直读

旧库不再由服务直读；先用 `tools/migrate-sqlite-to-mysql` 把旧 SQLite 快照灌进一次性 MySQL，
再让服务指向该库。旧库快照取自现网 `DATA_DIR` 的 `reminder.db`（连同 `-wal`/`-shm`），
只读拷贝后 `VACUUM INTO` 成干净快照，测试前后对现网库零写入。

迁移（`--dry-run` 计划 → 实迁 → `--verify` 只校验）：

```
表                   源行数       目标行数       抽样       结果
meta                 17         17        5       一致
reminders            90         90        5       一致
tags                  1          1        1       一致
settings              1          1        1       一致
images                0          0        0       一致
sessions              0          0        0       一致
users                 0          0        0       一致
audit                21         21        5       一致
迁移结束：源库与目标库逐表计数与抽样一致。
```

导入后服务运行在 MySQL 上，与「旧实现直接读同一份旧 SQLite」逐字段比对：

```
GET /api/version  旧 {"server":"reminderweb","version":"0.1.0","schemaVersion":1}
                  新 {"schemaVersion":1,"server":"reminderweb","version":"0.1.0"}
/api/data:      旧状态=200 新状态=200 深比较一致=true
/api/data/full: 旧状态=200 新状态=200 深比较一致=true
```

schema 由服务的 `internal/store/schema.sql`（`CREATE TABLE IF NOT EXISTS`，与旧库/云库逐字对齐）
在空库自建，启动即完成，无 DROP / TRUNCATE / 重建。

## 3. 备份 zip 双向互通

旧实现现场导出加密/明文各一份（`tools/old-backup-export.mjs`，只读旧仓库）：

```
old-enc.zip   bytes=2960 reminders=90 tags=1 hasWebdavCredentials=false
old-plain.zip bytes=2941 reminders=90 tags=1 hasWebdavCredentials=false
```

- 新实现导入旧「加密」包 → `{"applied":{"updated":1,"added":91,"removed":0,"rejected":0}}`，
  导入后计数 `reminders=90 tags=1 settings=1`。
- 再导入旧「明文」包 → 幂等 `added=0`。
- 新实现导出 → 旧实现 `decodeArchive` 读回：`reminders=90 tags=1 rejected=0`，设置键集合与
  旧实现导出完全一致，`hasWebdavCredentials=false`。

## 4. 同步引擎（隔离假 WebDAV）

两台新实例 A(19242)/B(19240) 共用隔离假 WebDAV(19241)：

```
[1] 空远端首同步 → 上传基线            lastAction=upload lastResult=ok
[2] A 本地新增 id=1001 → 上传          revision=1 reminders=1，远端文件数=2
[3] B 同步 → 远端→本地                 lastAction=pull lastMerged=1，B 本地 [1001,"A端新增"]
[4] A 墓碑删除 id=1001                 reminders=0，remindersDeleted=1，墓碑保留
    同步后墓碑不复活                    reminders=0 tombstones=[{id:1001,...}]
[5] 远端 PUT 500 / 不可达              lastResult=error（"服务器返回 500" / "连不上服务器…"），
                                       B 本地 revision=1 reminders=[1001] 不变
```

## 5. `/api/data/replace` 覆盖式替换

```
替换（1 提醒 + 1 标签 + 1 图片）: revision=1 counts={reminders:1,tags:1,images:1}
替换后计数: reminders=1 tags=1 images=1 settings=1 revision=1
图片取回: HTTP 200 bytes=75；原图/回取 sha256 一致
重复 id → HTTP 500 {"error":"replace_failed"}；回滚后仍为 id=7，revision 不变
缺 reminders → HTTP 400 {"error":"invalid_request"}
```

「迁移前自动导出备份」是前端迁移流程的行为（`web/src/components/ModeSettings.tsx`、
`web/src/lib/mode-migration.ts`），前端原样保留，未改动。

## 6. 认证（builtin / sso）

```
builtin:
  未认证 /api/data            → 401 {"error":"unauthorized"}
  错误口令登录                → 401 {"error":"invalid_credentials"}
  正确口令登录                → 200 Set-Cookie: __Host-rw_session=…; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000
  带 Cookie /api/auth/me      → 200 {"username":"admin","authMode":"builtin"}
  伪造 token                  → 401
  登出 → 200 {"ok":true}；登出后 me → 401
  连续 6 次错误登录（限 5）   → 401 401 401 401 401 429
sso:
  无 X-Auth-User /api/auth/me → 401
  带 X-Auth-User: alice       → 200 {"username":"alice","authMode":"sso"}
  POST /api/auth/login        → 400 {"error":"login_not_available"}
  非回环 HOST 启动            → 拒绝并退出（码 1）
```

> 修复记录：限流原先以 `RemoteAddr`（含临时端口 `ip:port`）为键，每次连接都算新客户端，
> 429 永不触发。已改为取主机部分（`internal/auth/auth.go` `hostFromRemoteAddr`），与旧实现的
> `socket.remoteAddress` 语义一致。

## 7. WebDAV 中继与凭据不回显

```
relayAllowPrivate=false 转发回环 → 403 target_not_allowed
打开允许内网后 PROPFIND 转发     → 207
错误凭据转发                     → 401
PATCH（不支持动词）              → 405 method_not_allowed
缺 X-Dav-Url                     → 400 missing_target
PUT 转发                         → 201
GET /api/webdav/config           → 只含 webdavPasswordSet:true，无口令明文
口令明文命中：响应体=0  server.log=0  中继口令在日志=0  审计表明文命中=0
```

审计仅记录 `webdav_config_update` 与字段名/`passwordChanged`，不含口令值。

## 8. 前端（无头 Chrome 真实驱动）

`tools/frontend-e2e.mjs`（Node 内建 fetch/WebSocket 直连 CDP，无第三方依赖）：

```
形态二（自带前端）EXIT=0：首屏渲染、进入新建页、新建一条、刷新后仍在、
                          分享图导出 PNG（reminder-1.png ~93KB）、控制台 error=0
形态一（纯静态）  EXIT=0：同上 6 步全部 PASS
```

`npm run typecheck` / `npm run build` 均 0 错。

## 9. 三种部署形态

```
① STATIC_ONLY=1          GET / 200；/api/health 404；/api/version 404
② 默认自带前端（空 cwd） GET / 200；/api/health 200；/api/version 200（走 //go:embed）
③ SERVE_STATIC=0 + CORS  GET / 404；/api/health 200；OPTIONS 204，命中
                         Access-Control-Allow-Origin/Credentials、Vary: Origin
```

## 10. 资源占用

```
二进制：8.72 MiB（静态链接、stripped，仅 MySQL 版；阈值 20 MiB）
启动后 /api/health 200：可达（一次性容器实测，纳秒级健康检查；阈值 300 ms）
空载 VmRSS：本轮未单独复测（仅存储层由内嵌 SQLite 换为 MySQL 客户端，驻留内存不增）
```

## 与旧实现的行为对齐

路由层已与旧实现**逐请求对齐**（只按「方法 + 路径」精确匹配；未注册路由 / 未支持动词一律
`404 not_found`；`HEAD` 不误配 `GET`；鉴权与读体次序一致；默认端口 `18940`）。完整对照矩阵、
复现脚本与已修复差异见 [`ROUTE-PARITY.md`](ROUTE-PARITY.md)。

静态托管的缓存头也已对齐。旧实现**没有「HTML 特例」**：`server/src/http.ts` 的 `serveStatic`
只按 `segments.length === 0` 区分——直接命中的静态文件（含显式请求的 `/index.html`）一律
`public, max-age=3600`，只有 SPA 回退到 `index.html`（`http.ts` 第 275 行）与目录根 `/` 才是
`no-cache`。新实现原先把 `index.html` 当作特例单独设 `no-cache`，与本轮对齐后已删除该特例。

### 已消除的差异（现已与旧实现一致）

| # | 请求 / 项 | 修复前（新） | 修复后（新） | 旧实现实测 |
|---|---|---|---|---|
| 1 | `GET /index.html` 的 `Cache-Control` | `no-cache` | `public, max-age=3600` | `public, max-age=3600` |
| 2 | 未设置 `PORT` 时的默认端口 | `19240` | `18940` | `18940` |

（第 2 项此前记录在 [`ROUTE-PARITY.md`](ROUTE-PARITY.md) §4，此处一并归档。）

### 复核后不属实的「差异」（旧实现本身就是该行为，非新旧差异）

1. `AUTH_MODE=sso` 下 `POST /api/auth/login` 返回 `400 login_not_available`：旧、新实测一致；
   与需求书 §7 文字写的「404」不同，属**需求书文字与旧实现不符**，以旧实现为功能权威，
   并非新旧实现之间的差异。
2. 备份 `metadata.json` 不含墓碑、跨设备「删除」不经备份包传播：备份格式与安卓端共用、字段本身
   没有墓碑，旧实现完全相同——属**格式的固有约束（两端共有）**，不是新旧差异。

### 仍存在的差异（仅构建 / 部署方式，非运行时行为）

1. 构建默认 `CGO_ENABLED=0`，产物为静态二进制（与 Dockerfile 一致）；旧实现是 Node 脚本。
   这属打包方式差异，不改变任何 HTTP 响应。

默认端口已对齐为 `18940`：未设置 `PORT` 时监听 `127.0.0.1:18940`（旧实现 `server/src/config.ts`
同为 `18940`），`deploy/` 下的 systemd 与 nginx 示例端口需按实际部署覆盖。

## 11. 存储迁移（SQLite → MySQL）验证

脚手架 `.acceptance/`（不入库）按「旧库快照 → 迁移工具灌入一次性 MySQL → 跑路由 parity 与核心用例」
的顺序取证，全部只打 `127.0.0.1` 高位端口，结束即 `docker rm -f` 容器、停临时进程，不留常驻实例。

迁移工具：`--dry-run`（只读源库）→ 实迁 → 再迁一次（幂等）→ `--verify`（只校验），逐表计数与抽样一致，
非 0 退出即失败，详见 §2。路由 parity：

```
$ node tools/route-parity.mjs --old http://127.0.0.1:19555 --new http://127.0.0.1:19557
核对 234 个请求，差异 0 个
```

核心用例（新服务运行在导入旧库的 MySQL 上，`AUTH_MODE=builtin`）：

```
== 鉴权（builtin）==
未认证 GET /api/data        -> 401
错误口令 POST /api/auth/login -> 401
正确口令 POST /api/auth/login -> 200
会话 Cookie 前缀             -> __Host-rw_session
带会话 GET /api/auth/me      -> {"authMode":"builtin","username":"admin"}

== 数据读写（reminders / tags 表）==
PUT 前 revision=29 reminders=90
PUT /api/data 新增一条       -> 200
PUT 后 revision=30 reminders=91 含新增=true

== 图片存取（images 表 longblob）==
PUT /api/images/acc-test.bin -> 200
GET /api/images/acc-test.bin -> 200
回取字节与上传一致           -> true
DELETE /api/images/acc-test.bin -> 200

== 设置（settings 表）==
GET /api/sync/config         -> 200
PUT /api/sync/config         -> 200
GET 回读 intervalMinutes     -> 30

== 登出 ==
POST /api/auth/logout        -> 200
```

重启持久化（证明写入落在 MySQL，而非进程内）：

```
写入后进程 PID=…，重启以验证数据落在 MySQL
重启后 revision=31 reminders=91 tags=2 含重启前标签=true
```

sso 模式：

```
无 X-Auth-User  GET /api/auth/me -> 401
带 X-Auth-User: alice GET /api/auth/me -> {"authMode":"sso","username":"alice"}
sso 下 POST /api/auth/login -> 400
```

## 已知限制

- 旧库快照取自现网 `DATA_DIR` 的 `reminder.db`（连同 `-wal`/`-shm`），只读拷贝后 `VACUUM INTO`
  成干净快照再迁移，自始至终未对现网库做任何写操作。
- `internal/sync`、`internal/webdav`、`internal/store` 无独立单测，链路由验收脚本（假 WebDAV）
  与手工端到端覆盖；`store` 的建表/缺列迁移由一次性 MySQL 容器上的集成用例覆盖。
- 迁移工具按主键序抽样比对（默认前 5 行）而非全表逐字段哈希，超大表下仍以「行数一致」为主判据。
