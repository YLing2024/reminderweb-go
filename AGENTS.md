# AGENTS.md — reminderweb-go 维护约定

本仓库是 ReminderWeb（纪念日提醒）后端的 Go 重写。前端为保留的 React PWA。
权威工程规范见 `/root/proj/ENGINEERING_BASELINE.md`；本文件只做本仓库补充，不降低其要求。

## 技术栈（固定）

- HTTP：仅标准库 `net/http`；不引 web 框架与路由库。
- SQLite：`modernc.org/sqlite`（纯 Go、无 cgo），能直接读写既有 `reminder.db`。
- 配置：环境变量为主（与部署的 `EnvironmentFile` 一致）+ 可选 YAML（`gopkg.in/yaml.v3`）。
- 加密：标准库 `crypto/*`；scrypt 口令派生在 `internal/scrypt` 纯标准库实现，不引 `x/crypto`。
- 日志：标准库 `log/slog`。
- 前端：React + Vite + TS，产物 `web/dist` 经根包 `//go:embed` 打进二进制。

**允许的第三方依赖只有 `modernc.org/sqlite` 与 `gopkg.in/yaml.v3`**；新增依赖先改 `go-rewrite/docs/00-CONVENTIONS.md` 再使用。

## 目录

- `cmd/reminderweb-go/`：进程入口（装配 + 优雅退出）。
- `internal/store/`：SQLite 打开、schema、PRAGMA、meta/revision/audit。
- `internal/scrypt/`：纯标准库 scrypt 口令派生（对齐旧实现的参数 N=16384,r=8,p=1）。
- `internal/wire/`：同步条目 / 墓碑 / 设置信封的校验与解析（旧 `serialize.ts`）。
- `internal/shape/`：安卓条目 ⇄ 内部形状归一化（旧 `normalize.ts` + `android-shape.ts`）。
- `internal/data/`：条目级合并、读写、整库替换。
- `internal/backup/`：zip 读写、AES/CBC 加解密、备份包格式（与安卓互通）。
- `internal/images/`、`internal/settings/`、`internal/syncconfig/`、`internal/webdav/`、`internal/ssrf/`。
- `internal/auth/`：会话 Cookie、users/sessions、`AUTH_MODE`、登录限流。
- `internal/sync/`：WebDAV 双向同步引擎。
- `internal/httpapi/`：路由装配、CORS、静态托管。
- `web/`：前端源码（从旧仓库搬入，仅做构建与 API 基址对齐的最小改动）。
- `tools/fakedav/`：本地验收用的隔离假 WebDAV（不参与生产部署）。

## 两条硬约束（改动前必读）

1. **备份包格式双向兼容**：文件名 `reminder-backup-yyyyMMdd-HHmmss.zip`、内含 `metadata.json`、
   可选 `images/`、加密为 AES-256-CBC + PKCS7，密钥 = SHA-256(seed)，`seed[i] = obfuscated[i] XOR 90`，
   密文布局 `[16 字节 IV][密文]`。密钥常量不得单独改动，须与前端 `web/src/lib/backup.ts` 一致。
2. **既有数据库直读**：schema、表结构、PRAGMA（`journal_mode=WAL`、`foreign_keys=ON`、
   `busy_timeout=5000`）不得改；迁移只需指向既有 `DATA_DIR`。

## 红线

- 备份包与上传的 `metadata.json` **绝不**含 `webDavServer/webDavUsername/webDavPassword/webDavPath`。
- WebDAV 凭据只从环境变量或库内设置读取，绝不进日志、错误信息、API 响应。
- 源码、配置、文档不得出现真实域名 / 公网 IP / 真实邮箱 / 密钥 / 真实口令；示例统一 `example.com` / `127.0.0.1`。
- 只监听 `127.0.0.1`；生产端口 19240。
- 不引第三方日志库；不写 `fmt.Println` 调试残留；不留注释掉的死代码；新增 TODO/FIXME 必须为 0。

## 命令

- `make web`：构建前端产物。`make build`：构建二进制（自动先建前端）。
- `make test` / `make race` / `make vet` / `make check`（vet + 路由文档机检 + 单测）。
- 依赖安装与前端命令一律带 `timeout`。

## 提交

小步提交、中文信息、不带署名与 TASK 号；**禁止** `git push`、`checkout -b`、`rebase`、
`reset --hard`、`merge`；不要 `git add` 运行产物（`web/dist`、二进制、数据目录）。
