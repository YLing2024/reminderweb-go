BINARY := reminderweb-go
GOFLAGS := -trimpath
LDFLAGS := -s -w
WEB_DIST := web/dist/index.html
# 只测本仓库的 Go 包，避免误扫 web/node_modules 里的第三方 Go 源码。
PKGS := ./cmd/... ./internal/... ./tools/...
# 独立 module 的一次性迁移工具；根模块的 ./... 不会扫到它，需单独 vet/test。
TOOL_DIR := tools/migrate-sqlite-to-mysql

.PHONY: all web build test race vet check fmt clean docker run

all: build

# 前端产物；构建后由根包 go:embed 打进二进制。
$(WEB_DIST):
	cd web && npm install --no-audit --no-fund && npm run build

web: $(WEB_DIST)

build: web
	CGO_ENABLED=0 go build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(BINARY) ./cmd/reminderweb-go

test: web
	scripts/test-mysql.sh go test $(PKGS) -count=1
	cd $(TOOL_DIR) && go test ./... -count=1

race: web
	scripts/test-mysql.sh go test $(PKGS) -count=1 -race
	cd $(TOOL_DIR) && go test ./... -count=1 -race

vet: web
	go vet ./...
	cd $(TOOL_DIR) && go vet ./...

# 机检路由↔文档一致 + vet + 单测（聚合门禁）；单测跑在一次性 MySQL 容器上。
check: web vet
	node scripts/check-api-docs.mjs
	scripts/test-mysql.sh go test $(PKGS) -count=1
	cd $(TOOL_DIR) && go test ./... -count=1

fmt:
	gofmt -l .

run: build
	./$(BINARY)

# 本地验收用的隔离假 WebDAV（只用于测试，不参与生产部署）。
fakedav:
	go build -o tools/fakedav/fakedav ./tools/fakedav

docker:
	docker build -t reminderweb-go:latest .

clean:
	rm -f $(BINARY) tools/fakedav/fakedav
	rm -f $(TOOL_DIR)/migrate-sqlite-to-mysql
	rm -rf web/dist
