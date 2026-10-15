# 验收报告

需求书 §7 的 10 条验收逐条执行记录。所有命令均在隔离环境执行：只监听 `127.0.0.1:19240`
（同步/中继用到的隔离假 WebDAV 在 `127.0.0.1:19241/19243`），绝不触碰现网 `18940`。
验收工作目录：`/root/.hermes/cache/scratch/opencode/rw-acc/final/`；旧实现只读参考，
用 `tools/old-backup-*.mjs`、`tools/db-count.mjs` 以 `node:sqlite` 只读方式核对，未修改旧仓库。

被测二进制：`CGO_ENABLED=0 go build -trimpath -ldflags "-s -w"` 产物，静态链接，
`sha256=798f8672869aa5217fdb4a24a00b48f0fb1332ccf69fbbd8c1f607580ec045da`。

## 1. 构建与测试

```bash
go vet ./...                                        # 无输出
go test ./cmd/... ./internal/... ./tools/... -count=1
go test ./internal/... -count=1 -race
make check                                          # vet + 路由↔文档机检 + 单测
```

`go vet` 零输出；`go test` 全绿；`-race` 全绿；`make check` 退出 0。前端：

```bash
cd web && npm run typecheck   # tsc -b，退出 0
cd web && npm run build       # vite build，退出 0
```

## 2. 旧数据库直读

拷贝现网 `DATA_DIR` 的 `reminder.db`（连同 `-wal`/`-shm`）到隔离目录，新实现直接打开读:

```
health: {"authMode":"none","authWarning":false,"ok":true,"revision":24}
db-count（只读统计副本库）: reminders=90 tags=1 settings=1 images=0 revision=24 schemaVersion=1 journalMode=wal
旧实现只读解析: {"reminders":90,"tags":1,"settingsKeys":13,"tombstones":0}
旧实现读库 vs 新服务 /api/data: 逐条 id+updatedAt 与设置键集合完全一致：true
schema（prod 源库 vs 服务打开后的副本）: 完全一致（14 行对象，无差异）
```

源库哈希在测试前后一致（`reminder.db` sha256 `a15b1a57…`）。`store.Open` 保持
`journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout=5000`，schema 不迁移。

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
二进制：12.32 MiB（静态链接、stripped；阈值 20 MiB）
空载 VmRSS：≈14.6 MiB（阈值 25 MiB）
冷启动到 /api/health 200：68 ms（阈值 300 ms）
```

## 与旧实现的行为对齐

路由层已与旧实现**逐请求对齐**（只按「方法 + 路径」精确匹配；未注册路由 / 未支持动词一律
`404 not_found`；`HEAD` 不误配 `GET`；鉴权与读体次序一致；默认端口 `18940`）。完整对照矩阵、
复现脚本与已修复差异见 [`ROUTE-PARITY.md`](ROUTE-PARITY.md)。

仍属有意的非路由差异：

1. `AUTH_MODE=sso` 下 `POST /api/auth/login` 返回 `400 login_not_available`（与旧实现一致）；
   需求书 §7 文字写的是「404」，此处以旧实现为功能权威。
2. 备份 metadata 不含墓碑（备份格式与安卓端共用，无墓碑字段），同步合并恒以空墓碑参与——
   与旧实现完全一致；因此跨设备的「删除」不通过备份包传播，需依赖后续任一端的整库迁移。
3. 构建默认 `CGO_ENABLED=0`，产物为静态二进制（与 Dockerfile 一致）。

## 已知限制

- 旧库 WAL 模式下，`reminder.db` 主文件哈希稳定，但 `-wal` 会因现网服务自身写入而变化；
  验收以「同一次测试前后一致」判定，未对现网库做任何写操作。
- `internal/sync`、`internal/webdav`、`internal/store` 无独立单测，链路由验收脚本（假 WebDAV）
  与手工端到端覆盖。
