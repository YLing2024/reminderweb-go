BINARY := reminderweb-go
GOFLAGS := -trimpath
LDFLAGS := -s -w
WEB_DIST := web/dist/index.html

.PHONY: all web build test race vet check fmt clean docker run

all: build

# 前端产物；构建后由根包 go:embed 打进二进制。
$(WEB_DIST):
	cd web && npm install --no-audit --no-fund && npm run build

web: $(WEB_DIST)

build: web
	CGO_ENABLED=0 go build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(BINARY) ./cmd/reminderweb-go

test: web
	go test ./... -count=1

race: web
	go test ./... -count=1 -race

vet: web
	go vet ./...

# 机检路由↔文档一致 + vet + 单测（聚合门禁）。
check: web vet
	node scripts/check-api-docs.mjs
	go test ./... -count=1

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
	rm -rf web/dist
