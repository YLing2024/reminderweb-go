# reminderweb-go

纪念日提醒（ReminderWeb）后端的 Go 重写。前端为原样的 React PWA，产物经 `//go:embed` 打进单个二进制。

本仓库是既有 Node 实现的 Go 版本，行为逐条对齐；与前端的 HTTP 契约见 [`docs/API.md`](docs/API.md)，
前端可复用组件见 [`docs/COMPONENTS.md`](docs/COMPONENTS.md)。

## 特性

- **单二进制**：内嵌前端 `web/dist`，一个可执行文件即可对外服务。
- **三种部署形态**：纯静态（只托管前端）、二进制自带前端、前后端分离（只 API + CORS）。
- **直读既有数据库**：SQLite schema 与 PRAGMA（`journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout=5000`）与旧实现一致，
  迁移时把 `DATA_DIR` 指向既有目录即可，无需重新导入。
- **备份包双向兼容**：zip（含 `metadata.json`，可选 `images/`）与安卓端互通；加密为 AES-256-CBC + PKCS7。
- **WebDAV 双向同步**：条目级合并（按 `updatedAt` / 墓碑），自动同步可页面开关、改完立即生效。
- **浏览器侧 WebDAV 中继**：绕开 CORS 直连远端；内置 SSRF 防护，默认拒绝内网 / 云元数据目标。

## 技术栈

| 侧 | 选择 |
|---|---|
| 运行时 | Go 1.26 |
| HTTP | 仅标准库 `net/http`（不引 web 框架 / 路由库）|
| 数据库 | `modernc.org/sqlite`（纯 Go，无 cgo）|
| 配置 | 环境变量 + 可选 YAML（`gopkg.in/yaml.v3`）|
| 加密 | 标准库 `crypto/*`；scrypt 在 `internal/scrypt` 纯标准库实现 |
| 日志 | 标准库 `log/slog` |
| 前端 | React + Vite + TypeScript，PWA |

第三方依赖仅 `modernc.org/sqlite` 与 `gopkg.in/yaml.v3`。

## 目录

```
cmd/reminderweb-go/   入口（装配 + 优雅退出）
internal/config/      环境变量 / YAML 配置加载与校验
internal/store/       SQLite 打开、schema、PRAGMA、meta/revision/audit
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
docs/API.md           HTTP 契约（权威）
docs/ACCEPTANCE.md    需求书 §7 的 10 条验收真实记录与差异清单
docs/COMPONENTS.md    前端组件登记
```

## 构建

```bash
make build      # 先构建前端（web/dist），再构建二进制（自动 embed）
make web        # 只构建前端
make test       # go test ./... -count=1
make race       # 并发相关再跑 -race
make vet        # go vet ./...
make check      # vet + 路由↔文档机检 + 单测（聚合门禁）
```

依赖安装与前端命令一律带 `timeout`。

## 运行

```bash
cp .env.example reminderweb.env   # 按需修改
DATA_DIR=/var/lib/reminderweb-go PORT=19240 AUTH_MODE=builtin ./reminderweb-go
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

见 `.env.example`。要点：`HOST`/`PORT`/`DATA_DIR`、`AUTH_MODE`/`AUTH_USER`/`AUTH_PASSWORD`/`SESSION_TTL_DAYS`、
`SERVE_STATIC`/`STATIC_ONLY`/`ALLOWED_ORIGINS`/`COOKIE_SAMESITE`、`WEBDAV_*`。

## 迁移

把 `DATA_DIR` 指向旧服务的既有数据目录，新实现会直接打开既有的 `reminder.db`，schema 与 PRAGMA 不变。
WebDAV 连接一开始沿用 `WEBDAV_*` 环境变量，之后以页面上设置（存在库里）的值为准。

## 与旧实现的行为对齐

路由层已与旧 Node 实现**逐请求对齐**（未注册路由 / 未支持动词一律 `404 not_found`、`HEAD` 不误配 `GET`、
鉴权次序与读体次序一致）：默认端口 `18940`、完整对照矩阵与复现脚本见
[`docs/ROUTE-PARITY.md`](docs/ROUTE-PARITY.md)。其余有意差异（备份包不含墓碑等）见
[`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md)。

## 许可

GPL-3.0，见 [`LICENSE`](LICENSE)。
