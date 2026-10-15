#!/usr/bin/env bash
# 起一个一次性 MySQL 容器（只绑 127.0.0.1 的随机高位端口），把命令行当测试命令执行，
# 退出时无论成败都用 docker rm -f 清掉容器，不留常驻实例。
#
# 用法：scripts/test-mysql.sh go test ./cmd/... ./internal/... ./tools/... -count=1
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "需要 docker 以启动一次性 MySQL 容器" >&2
  exit 1
fi

MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8.4}"
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-90}"

# 随机根口令，绝不出现在仓库或日志里。
ROOT_PASSWORD="$(od -An -tx1 -N 16 /dev/urandom | tr -d ' \n')"

CONTAINER_ID="$(docker run -d --rm \
  --name "rwtest-mysql-$$" \
  -e MYSQL_ROOT_PASSWORD="$ROOT_PASSWORD" \
  -p 127.0.0.1::3306 \
  "$MYSQL_IMAGE")"

cleanup() {
  docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 "$READY_TIMEOUT_SECONDS"); do
  if docker exec "$CONTAINER_ID" mysqladmin ping -h127.0.0.1 -uroot -p"$ROOT_PASSWORD" --silent >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  echo "MySQL 容器未在 ${READY_TIMEOUT_SECONDS}s 内就绪；最后 40 行日志：" >&2
  docker logs "$CONTAINER_ID" 2>&1 | tail -40 >&2 || true
  exit 1
fi

MYSQL_PORT="$(docker port "$CONTAINER_ID" 3306/tcp | head -1 | sed 's/.*://')"
export TEST_MYSQL_DSN="root:${ROOT_PASSWORD}@tcp(127.0.0.1:${MYSQL_PORT})/"

echo "临时 MySQL 就绪：127.0.0.1:${MYSQL_PORT}（容器 ${CONTAINER_ID:0:12}，测试结束即删除）"
"$@"
