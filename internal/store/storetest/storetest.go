// Package storetest 提供依赖真实 MySQL 的测试脚手架。
//
// 仅测试使用：生产二进制不会 import 本包。每个用例从 TEST_MYSQL_DSN
// （形如 root:example-pass@tcp(127.0.0.1:3307)/）指向的临时 MySQL 实例上
// 建一个独占空库并完成建表迁移，用例结束只关闭连接；库本身不 DROP，
// 随 scripts/test-mysql.sh 起的一次性容器一起丢弃。
package storetest

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"testing"

	"github.com/go-sql-driver/mysql"

	"reminderweb-go/internal/store"
)

// DSNEnv 是测试用 MySQL 基础 DSN 的环境变量名（含账号密码与地址，不含库名）。
const DSNEnv = "TEST_MYSQL_DSN"

// Open 建一个本用例独占的空库并迁移，返回可用的 *store.DB；未设置 DSN 时跳过用例。
func Open(t *testing.T) *store.DB {
	t.Helper()
	base := os.Getenv(DSNEnv)
	if base == "" {
		t.Skipf("未设置 %s（需一次性 MySQL 实例），跳过依赖数据库的用例", DSNEnv)
	}
	cfg, err := mysql.ParseDSN(base)
	if err != nil {
		t.Fatalf("解析 %s 失败：%v", DSNEnv, err)
	}
	name := "rwtest_" + randomSuffix()
	if err := createDatabase(cfg, name); err != nil {
		t.Fatalf("创建测试库失败：%v", err)
	}
	cfg.DBName = name
	db, err := store.OpenDSN(cfg.FormatDSN())
	if err != nil {
		t.Fatalf("打开测试库失败：%v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// createDatabase 用不带库名的连接建一个 utf8mb4 空库。
func createDatabase(base *mysql.Config, name string) error {
	cfg := *base
	cfg.DBName = ""
	conn, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	_, err = conn.Exec(fmt.Sprintf("CREATE DATABASE `%s` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci", name))
	return err
}

func randomSuffix() string {
	buffer := make([]byte, 6)
	if _, err := rand.Read(buffer); err != nil {
		return "fallback"
	}
	return hex.EncodeToString(buffer)
}
