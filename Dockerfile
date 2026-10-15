# 多阶段构建：先构建前端与 Go 二进制，再产出最小运行镜像。
# 前端产物经 go:embed 打进二进制，运行镜像只需二进制本身。
FROM node:24-bookworm AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.24-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/reminderweb-go ./cmd/reminderweb-go

FROM debian:bookworm-slim
RUN useradd --system --create-home --home-dir /var/lib/reminderweb-go reminderweb
USER reminderweb
WORKDIR /var/lib/reminderweb-go
COPY --from=build /out/reminderweb-go /usr/local/bin/reminderweb-go
ENV HOST=127.0.0.1 PORT=19240 DATA_DIR=/var/lib/reminderweb-go
EXPOSE 19240
ENTRYPOINT ["/usr/local/bin/reminderweb-go"]
