# reminderweb-go

纪念日提醒（ReminderWeb）后端的 Go 重写。前端为原样的 React PWA，产物经 `//go:embed` 打进单个二进制。

本仓库是既有 Node 实现的 Go 版本，行为逐条对齐；与前端的 HTTP 契约见 [`docs/API.md`](docs/API.md)，
前端可复用组件见 [`docs/COMPONENTS.md`](docs/COMPONENTS.md)。

## 特性

- **单二进制**：内嵌前端 `web/dist`，一个可执行文件即可对外服务。
- **三种部署形态**：纯静态（只托管前端）、二进制自带前端、前后端分离（只 API + CORS）。
- **MySQL 存储**：运行期只有 MySQL 一条路径（`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`
  或单条 `DB_DSN`）；schema 与既有云库逐字对齐，缺列只 `ADD COLUMN`，绝不 `DROP` / 重建。
- **一次性迁移工具**：`tools/migrate-sqlite-to-mysql` 独立命令，把旧 SQLite 只读搬到 MySQL，
  每表走「源计数 → 拷贝 → 目标计数 → 抽样比对」，支持 `--dry-run` / `--verify`。
- **备份包双向兼容**：zip（含 `metadata.json`，可选 `images/`）与安卓端互通；加密为 AES-256-CBC + PKCS7。
- **WebDAV 双向同步**：条目级合并（按 `updatedAt` / 墓碑），自动同步可页面开关、改完立即生效。
- **浏览器侧 WebDAV 中继**：绕开 CORS 直连远端；内置 SSRF 防护，默认拒绝内网 / 云元数据目标。

## 技术栈

| 侧 | 选择 |
|---|---|
| 运行时 | Go 1.26 |
| HTTP | 仅标准库 `net/http`（不引 web 框架 / 路由库）|
| 存储 | MySQL，驱动 `github.com/go-sql-driver/mysql`（纯 Go，无 cgo）|
| 配置 | 环境变量 + 可选 YAML（`gopkg.in/yaml.v3`）|
| 加密 | 标准库 `crypto/*`；scrypt 在 `internal/scrypt` 纯标准库实现 |
| 日志 | 标准库 `log/slog` |
| 前端 | React + Vite + TypeScript，PWA |

服务主程序的第三方依赖仅 `github.com/go-sql-driver/mysql` 与 `gopkg.in/yaml.v3`；
读旧 SQLite 的 `modernc.org/sqlite` 只存在于独立 module `tools/migrate-sqlite-to-mysql`。

## 目录

```
cmd/reminderweb-go/   入口（装配 + 优雅退出）
internal/config/      环境变量 / YAML 配置加载与校验
internal/store/       MySQL 连接、建表 + 缺列迁移、schema_version、meta/revision/audit
internal/scrypt/      纯标准库 scrypt（N=16384,r=8,p=1）
internal/wire/        同步条目 / 墓碑 / 设置信封的校验与解析
internal/shape/       安卓条目 ⇄ 内部形状归一化
internal/data/        条目级合并、读写、整库替换
internal/backup/      zip 读写、AES/CBC 加解密、备份包格式
internal/images/      图片字节存取
internal/settings/    服务器级 WebDAV 设置
internal/syncconfig/  同步配置兼容视图
internal/webdav/      WebDAV 客户端
internal/ssrf/        中继目标 SSRF 防护
internal/auth/        会话 Cookie、users/sessions、认证模式、登录限流
internal/sync/        WebDAV 双向同步引擎
internal/httpapi/     路由装配、CORS、静态托管
web/                  前端源码（dist 被根包 go:embed）
tools/fakedav/        验收用隔离假 WebDAV（不参与生产）
tools/migrate-sqlite-to-mysql/  一次性 SQLite→MySQL 迁移工具（独立 module）
docs/API.md           HTTP 契约（权威）
docs/ACCEPTANCE.md    需求书 §7 的 10 条验收真实记录与差异清单
docs/COMPONENTS.md    前端组件登记
```

## 构建

```bash
make build      # 先构建前端（web/dist），再构建二进制（自动 embed）
make web        # 只构建前端
make test       # 一次性 MySQL 容器里跑 go test（含迁移工具 module）
make race       # 并发相关再跑 -race
make vet        # go vet ./...（含迁移工具 module）
make check      # vet + 路由↔文档机检 + 单测（聚合门禁）
```

依赖安装与前端命令一律带 `timeout`。`make test`/`make check` 会用 `scripts/test-mysql.sh`
起一个只绑 `127.0.0.1` 随机高位端口的 `mysql:8.4` 容器，结束即删除，不留常驻实例；
直接 `go test ./...` 而不设 `TEST_MYSQL_DSN` 时，数据库相关用例会 skip。

## 运行

```bash
cp .env.example reminderweb.env   # 按需修改
DB_HOST=127.0.0.1 DB_NAME=reminderweb DB_USER=reminderweb DB_PASSWORD=… PORT=19240 AUTH_MODE=builtin ./reminderweb-go
```

只监听回环地址，对外由 nginx 反向代理（示例见 `deploy/nginx.conf.example`）；systemd 单元示例见
`deploy/reminderweb-go.service`。容器镜像见 `Dockerfile`（多阶段构建，运行镜像只有二进制）。

### 三种部署形态

| 形态 | 关键配置 | 行为 |
|---|---|---|
| 纯静态 | `STATIC_ONLY=1` | 只托管前端产物，`/api/*` 一律 404。|
| 二进制自带前端 | 默认（`SERVE_STATIC=1`，无 `ALLOWED_ORIGINS`）| 同源提供前端 + API。|
| 分离 | `SERVE_STATIC=0` + `ALLOWED_ORIGINS=https://app.example.com` | 后端只提供 API，按白名单放行跨域。|

### 主要环境变量

见 `.env.example`。要点：`HOST`/`PORT`、`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`/`DB_DSN`、
`AUTH_MODE`/`AUTH_USER`/`AUTH_PASSWORD`/`SESSION_TTL_DAYS`、
`SERVE_STATIC`/`STATIC_ONLY`/`ALLOWED_ORIGINS`/`COOKIE_SAMESITE`、`WEBDAV_*`。

## 从旧 SQLite 迁移

建好空的 MySQL 库后，先用迁移工具把旧 `reminder.db` 一次性导入，再让服务指向它：

```bash
# 1) 看旧库各表行数，不连、不写 MySQL
cd tools/migrate-sqlite-to-mysql && go run . --sqlite /path/to/reminder.db --dry-run
# 2) 建表（幂等）并拷数据：源库只读，目标重复执行收敛、不产生重复行
go run . --sqlite /path/to/reminder.db --dsn 'reminderweb:…@tcp(127.0.0.1:3306)/reminderweb'
# 3) 只校验：不拷贝，比对源库 / 目标库逐表计数与抽样
go run . --sqlite /path/to/reminder.db --dsn '…' --verify
```

任一表计数或抽样不一致时工具非 0 退出。WebDAV 连接一开始沿用 `WEBDAV_*` 环境变量，
之后以页面上设置（存在库里）的值为准。

## 与旧实现的行为对齐

路由层已与旧 Node 实现**逐请求对齐**（未注册路由 / 未支持动词一律 `404 not_found`、`HEAD` 不误配 `GET`、
鉴权次序与读体次序一致）；静态托管缓存头亦已对齐（直接命中的 `GET /index.html` 为
`public, max-age=3600`，仅 SPA 回退与目录根为 `no-cache`）。默认端口 `18940`、完整对照矩阵与复现脚本见
[`docs/ROUTE-PARITY.md`](docs/ROUTE-PARITY.md)。运行时行为无有意差异，仅构建方式不同
（`CGO_ENABLED=0` 静态二进制）；逐条复核记录见 [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md)。

## 许可

GPL-3.0，见 [`LICENSE`](LICENSE)。
