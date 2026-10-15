# AGENTS.md — reminderweb-go 维护约定

本仓库是 ReminderWeb（纪念日提醒）后端的 Go 重写。前端为保留的 React PWA。
权威工程规范见 `/root/proj/ENGINEERING_BASELINE.md`；本文件只做本仓库补充，不降低其要求。

## 技术栈（固定）

- HTTP：仅标准库 `net/http`；不引 web 框架与路由库。
- 存储：MySQL 单一路径，驱动 `github.com/go-sql-driver/mysql`（纯 Go、无 cgo）；没有 SQLite 实现与方言分支。
- 配置：环境变量为主（与部署的 `EnvironmentFile` 一致）+ 可选 YAML（`gopkg.in/yaml.v3`）。
- 加密：标准库 `crypto/*`；scrypt 口令派生在 `internal/scrypt` 纯标准库实现，不引 `x/crypto`。
- 日志：标准库 `log/slog`。
- 前端：React + Vite + TS，产物 `web/dist` 经根包 `//go:embed` 打进二进制。

**服务主程序允许的第三方依赖只有 `github.com/go-sql-driver/mysql` 与 `gopkg.in/yaml.v3`**；
新增依赖先改 `go-rewrite/docs/00-CONVENTIONS.md` 再使用。读旧 SQLite 的依赖
（`modernc.org/sqlite`）只允许出现在独立 module `tools/migrate-sqlite-to-mysql` 里，主程序不得 import。

## 目录

- `cmd/reminderweb-go/`：进程入口（装配 + 优雅退出）。
- `internal/store/`：MySQL 连接、按 `schema.sql` 建表与缺列迁移、`schema_version`、meta/revision/audit。
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
- `tools/migrate-sqlite-to-mysql/`：独立 module 的一次性迁移工具，把旧 SQLite 搬到 MySQL（服务不 import）。

## 两条硬约束（改动前必读）

1. **备份包格式双向兼容**：文件名 `reminder-backup-yyyyMMdd-HHmmss.zip`、内含 `metadata.json`、
   可选 `images/`、加密为 AES-256-CBC + PKCS7，密钥 = SHA-256(seed)，`seed[i] = obfuscated[i] XOR 90`，
   密文布局 `[16 字节 IV][密文]`。密钥常量不得单独改动，须与前端 `web/src/lib/backup.ts` 一致。
2. **schema 与迁移只增不毁**：表名、列名、列类型、索引名以
   `go-rewrite/docs/mysql-schema-cloud.md` 的 `reminderweb` 节为唯一权威，逐字落在
   `internal/store/schema.sql`（服务与迁移工具共用同一份）。空库自建、重复执行幂等；
   缺列只做 `ALTER TABLE ... ADD COLUMN`；**绝不** `DROP` / `TRUNCATE` / 重建表。
   旧 SQLite 数据只经 `tools/migrate-sqlite-to-mysql` 一次性导入，源库只读。

## 红线

- 备份包与上传的 `metadata.json` **绝不**含 `webDavServer/webDavUsername/webDavPassword/webDavPath`。
- WebDAV 凭据只从环境变量或库内设置读取，绝不进日志、错误信息、API 响应。
- 源码、配置、文档不得出现真实域名 / 公网 IP / 真实邮箱 / 密钥 / 真实口令；示例统一 `example.com` / `127.0.0.1`。
- 只监听 `127.0.0.1`；生产端口 19240。
- 不引第三方日志库；不写 `fmt.Println` 调试残留；不留注释掉的死代码；新增 TODO/FIXME 必须为 0。

## 命令

- `make web`：构建前端产物。`make build`：构建二进制（自动先建前端）。
- `make test` / `make race` / `make vet` / `make check`（vet + 路由文档机检 + 单测）。
- 单测跑在一次性 MySQL 容器上（`scripts/test-mysql.sh`，只绑 `127.0.0.1` 随机高位端口，
  结束即 `docker rm -f`）；未设 `TEST_MYSQL_DSN` 时数据库用例 skip。
- 依赖安装与前端命令一律带 `timeout`。

## 提交

小步提交、中文信息、不带署名与 TASK 号；**禁止** `git push`、`checkout -b`、`rebase`、
`reset --hard`、`merge`；不要 `git add` 运行产物（`web/dist`、二进制、数据目录）。
