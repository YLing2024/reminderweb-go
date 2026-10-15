package main

import "fmt"

// tableSpec 描述一张待搬迁的表；列顺序与 internal/store/schema.sql 一致。
type tableSpec struct {
	name    string
	columns []string
	// orderBy 是主键列，用于遍历与抽样排序，保证结果可复现。
	orderBy string
}

// tables 是旧 SQLite 库里的全部 8 张业务表，按外键无关的顺序排列。
var tables = []tableSpec{
	{name: "meta", columns: []string{"key", "value"}, orderBy: "key"},
	{name: "reminders", columns: []string{"id", "payload", "updated_at", "deleted"}, orderBy: "id"},
	{name: "tags", columns: []string{"id", "payload", "updated_at", "deleted"}, orderBy: "id"},
	{name: "settings", columns: []string{"k", "payload", "updated_at"}, orderBy: "k"},
	{name: "images", columns: []string{"name", "bytes", "updated_at"}, orderBy: "name"},
	{name: "sessions", columns: []string{"token_hash", "username", "created_at", "expires_at"}, orderBy: "token_hash"},
	{name: "users", columns: []string{"username", "salt", "hash", "created_at"}, orderBy: "username"},
	{name: "audit", columns: []string{"id", "at", "actor", "action", "detail"}, orderBy: "id"},
}

// selectSQL 生成按主键排序的只读查询。
func (t tableSpec) selectSQL() string {
	return fmt.Sprintf("SELECT %s FROM %s ORDER BY %s", quoteList(t.columns), quote(t.name), quote(t.orderBy))
}

// countSQL 生成行数统计语句。
func (t tableSpec) countSQL() string {
	return "SELECT COUNT(*) FROM " + quote(t.name)
}

// insertSQL 生成幂等写入语句：重复执行时更新为源库的值，不产生重复行。
func (t tableSpec) insertSQL() string {
	assignments := make([]string, 0, len(t.columns))
	for _, column := range t.columns {
		assignments = append(assignments, quote(column)+" = new."+quote(column))
	}
	placeholders := make([]string, len(t.columns))
	for i := range placeholders {
		placeholders[i] = "?"
	}
	return fmt.Sprintf(
		"INSERT INTO %s (%s) VALUES (%s) AS new ON DUPLICATE KEY UPDATE %s",
		quote(t.name), quoteList(t.columns), joinComma(placeholders), joinComma(assignments),
	)
}

func quote(identifier string) string { return "`" + identifier + "`" }

func quoteList(columns []string) string {
	out := make([]string, len(columns))
	for i, column := range columns {
		out[i] = quote(column)
	}
	return joinComma(out)
}

func joinComma(parts []string) string {
	joined := ""
	for i, part := range parts {
		if i > 0 {
			joined += ", "
		}
		joined += part
	}
	return joined
}
