package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestInsertSQLIsUpsert 固定写入语句的形态：占位符顺序与列顺序一致，
// 且用 `AS new ... ON DUPLICATE KEY UPDATE` 幂等收敛，避免重复执行产生重复行。
func TestInsertSQLIsUpsert(t *testing.T) {
	spec := tableSpec{name: "meta", columns: []string{"key", "value"}, orderBy: "key"}
	got := spec.insertSQL()
	want := "INSERT INTO `meta` (`key`, `value`) VALUES (?, ?) AS new ON DUPLICATE KEY UPDATE `key` = new.`key`, `value` = new.`value`"
	if got != want {
		t.Fatalf("insertSQL 不一致\nwant: %s\n got: %s", want, got)
	}
}

// TestSelectAndCountSQL 保证查询按主键排序（抽样可复现），计数不带条件。
func TestSelectAndCountSQL(t *testing.T) {
	spec := tableSpec{name: "reminders", columns: []string{"id", "payload"}, orderBy: "id"}
	if got, want := spec.selectSQL(), "SELECT `id`, `payload` FROM `reminders` ORDER BY `id`"; got != want {
		t.Fatalf("selectSQL = %q，want %q", got, want)
	}
	if got, want := spec.countSQL(), "SELECT COUNT(*) FROM `reminders`"; got != want {
		t.Fatalf("countSQL = %q，want %q", got, want)
	}
}

// TestCanonicalRowNormalizesDriverTypes 驱动间文本类型不同（SQLite 给 string、
// MySQL 给 []byte），规范化后必须可比较；NULL 与数字也要有稳定表示。
func TestCanonicalRowNormalizesDriverTypes(t *testing.T) {
	fromSQLite := canonicalRow([]any{"alice", int64(7), nil})
	fromMySQL := canonicalRow([]any{[]byte("alice"), int64(7), nil})
	if fromSQLite != fromMySQL {
		t.Fatalf("同内容不同驱动形态应相等：%q vs %q", fromSQLite, fromMySQL)
	}
	if canonicalRow([]any{"a|b"}) == canonicalRow([]any{"a", "b"}) {
		t.Fatal("前缀长度编码应让含分隔符与多列的串不相等")
	}
}

// TestLoadStatementsParsesSharedSchema 直接读服务共用的权威 DDL：
// 应切出 9 条建表语句，且迁移工具绝不会执行破坏性语句。
func TestLoadStatementsParsesSharedSchema(t *testing.T) {
	statements, err := loadStatements("../../internal/store/schema.sql")
	if err != nil {
		t.Fatalf("读取共享 schema 失败：%v", err)
	}
	if len(statements) != 9 {
		t.Fatalf("建表语句数 = %d，want 9", len(statements))
	}
	for _, statement := range statements {
		if !strings.HasPrefix(statement, "CREATE TABLE IF NOT EXISTS") {
			t.Fatalf("非幂等建表语句：%s", statement)
		}
		upper := strings.ToUpper(statement)
		for _, banned := range []string{"DROP ", "TRUNCATE ", "ALTER ", "DELETE "} {
			if strings.Contains(upper, banned) {
				t.Fatalf("schema 含破坏性语句 %q：%s", banned, statement)
			}
		}
	}
}

// TestLoadStatementsStripsComments 行注释与空语句要被丢弃。
func TestLoadStatementsStripsComments(t *testing.T) {
	path := filepath.Join(t.TempDir(), "schema.sql")
	content := "-- 说明\nCREATE TABLE `a` (\n  `id` bigint\n);\n-- 另一段\n\nCREATE TABLE `b` (`id` bigint);\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("写临时 schema 失败：%v", err)
	}
	statements, err := loadStatements(path)
	if err != nil {
		t.Fatalf("loadStatements 失败：%v", err)
	}
	if len(statements) != 2 {
		t.Fatalf("语句数 = %d，want 2：%#v", len(statements), statements)
	}
	if statements[0] != "CREATE TABLE `a` (\n  `id` bigint\n)" {
		t.Fatalf("第一条语句未按预期去注释：%q", statements[0])
	}
}
