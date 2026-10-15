// Package store 负责 MySQL 的连接、建表与增量迁移，并封装 meta / revision / audit。
//
// 运行期只有 MySQL 一条路径（口径变更 2026-10-16）：不再有 SQLite 驱动、DB_DRIVER
// 开关或方言分支。建表语句的权威源是 go-rewrite/docs/mysql-schema-cloud.md 的 `reminderweb`
// 节，逐字落在同目录的 schema.sql：表名、列名、列类型、索引名与云库既有数据完全对齐，
// 不另立一套，也不改动云库里已有的行。
//
// 迁移只增不毁：建表用 CREATE TABLE IF NOT EXISTS（幂等）；历史库缺列时只做
// ALTER TABLE ... ADD COLUMN；绝不 DROP / TRUNCATE / 重建表。
package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

// SchemaVersion 当前 schema 版本，写入 schema_version 表。
const SchemaVersion = 1

//go:embed schema.sql
var schemaFiles embed.FS

// Params 是 MySQL 连接参数；DSN 非空时直接使用，其余字段忽略。
type Params struct {
	Host     string
	Port     int
	Name     string
	User     string
	Password string
	DSN      string
}

// DSNString 生成 go-sql-driver 连接串（已给出 DSN 时原样返回）。
//
// 显式指定 utf8mb4_0900_ai_ci，与云库的库/表排序规则一致；口令字段交给驱动的
// FormatDSN 转义，源码里不拼接裸口令。
func (p Params) DSNString() string {
	if strings.TrimSpace(p.DSN) != "" {
		return p.DSN
	}
	cfg := mysql.NewConfig()
	cfg.User = p.User
	cfg.Passwd = p.Password
	cfg.Net = "tcp"
	cfg.Addr = net.JoinHostPort(p.Host, strconv.Itoa(p.Port))
	cfg.DBName = p.Name
	cfg.Collation = "utf8mb4_0900_ai_ci"
	cfg.Timeout = 5 * time.Second
	cfg.ReadTimeout = 30 * time.Second
	cfg.WriteTimeout = 30 * time.Second
	return cfg.FormatDSN()
}

// DB 是一次 MySQL 打开会话。
type DB struct {
	sql *sql.DB
}

// Querier 抽象 *sql.DB 与 *sql.Tx，便于同一套读写函数在事务内外复用。
type Querier interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

// SQL 暴露底层句柄，供各业务层在同一连接池上执行读写。
func (db *DB) SQL() *sql.DB { return db.sql }

// Close 关闭数据库。
func (db *DB) Close() error { return db.sql.Close() }

// Open 按参数连接 MySQL、校验连通性并完成迁移。
func Open(params Params) (*DB, error) { return OpenDSN(params.DSNString()) }

// OpenDSN 按完整 DSN 连接 MySQL、校验连通性并完成迁移；测试与迁移工具可直接使用。
func OpenDSN(dsn string) (*DB, error) {
	handle, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("打开 MySQL 失败：%w", err)
	}
	// 连接池参数取够用的默认值：并发请求少、事务短，避免占满服务端连接。
	handle.SetMaxOpenConns(16)
	handle.SetMaxIdleConns(4)
	handle.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := handle.PingContext(ctx); err != nil {
		_ = handle.Close()
		return nil, fmt.Errorf("连接 MySQL 失败：%w", err)
	}
	db := &DB{sql: handle}
	if err := migrate(db); err != nil {
		_ = handle.Close()
		return nil, err
	}
	return db, nil
}

// schemaStatements 读取并切分内嵌的 schema.sql；忽略 `--` 行注释。
func schemaStatements() ([]string, error) {
	raw, err := schemaFiles.ReadFile("schema.sql")
	if err != nil {
		return nil, fmt.Errorf("读取 schema.sql 失败：%w", err)
	}
	var out []string
	for _, chunk := range strings.Split(string(raw), ";") {
		var lines []string
		for _, line := range strings.Split(chunk, "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "--") {
				continue
			}
			lines = append(lines, line)
		}
		stmt := strings.TrimSpace(strings.Join(lines, "\n"))
		if stmt != "" {
			out = append(out, stmt)
		}
	}
	return out, nil
}

// columnRequirement 描述一张业务表必须存在的列；缺列时按 definition 补齐。
type columnRequirement struct {
	table      string
	column     string
	definition string
}

// requiredColumns 是 schema.sql 的列清单镜像，用于历史库缺列时的 ALTER TABLE ADD COLUMN。
// 只新增、不修改、不删除；已有的多余列一律不动。
var requiredColumns = []columnRequirement{
	{"audit", "id", "bigint NOT NULL AUTO_INCREMENT"},
	{"audit", "at", "bigint NOT NULL"},
	{"audit", "actor", "longtext NOT NULL"},
	{"audit", "action", "longtext NOT NULL"},
	{"audit", "detail", "longtext"},
	{"images", "name", "varchar(256) NOT NULL"},
	{"images", "bytes", "longblob NOT NULL"},
	{"images", "updated_at", "bigint NOT NULL"},
	{"meta", "key", "varchar(256) NOT NULL"},
	{"meta", "value", "longtext NOT NULL"},
	{"reminders", "id", "bigint NOT NULL AUTO_INCREMENT"},
	{"reminders", "payload", "longtext NOT NULL"},
	{"reminders", "updated_at", "bigint NOT NULL"},
	{"reminders", "deleted", "bigint NOT NULL DEFAULT '0'"},
	{"sessions", "token_hash", "varchar(256) NOT NULL"},
	{"sessions", "username", "longtext NOT NULL"},
	{"sessions", "created_at", "bigint NOT NULL"},
	{"sessions", "expires_at", "bigint NOT NULL"},
	{"settings", "k", "varchar(256) NOT NULL"},
	{"settings", "payload", "longtext NOT NULL"},
	{"settings", "updated_at", "bigint NOT NULL"},
	{"tags", "id", "bigint NOT NULL AUTO_INCREMENT"},
	{"tags", "payload", "longtext NOT NULL"},
	{"tags", "updated_at", "bigint NOT NULL"},
	{"tags", "deleted", "bigint NOT NULL DEFAULT '0'"},
	{"users", "username", "varchar(256) NOT NULL"},
	{"users", "salt", "longtext NOT NULL"},
	{"users", "hash", "longtext NOT NULL"},
	{"users", "created_at", "bigint NOT NULL"},
}

// migrate 建表 + 补齐缺列 + 记录 schema 版本，可对空库与既有库重复执行。
//
// MySQL 的 DDL 会隐式提交，无法整体包进一个事务；因此建表/加列逐条幂等执行，
// 版本台账的读写单独放在一个事务里，保证台账不会出现半写状态。
func migrate(db *DB) error {
	statements, err := schemaStatements()
	if err != nil {
		return err
	}
	for _, statement := range statements {
		if _, err := db.sql.Exec(statement); err != nil {
			return fmt.Errorf("建表失败：%w", err)
		}
	}
	if err := ensureColumns(db.sql); err != nil {
		return err
	}
	return recordSchemaVersion(db.sql)
}

// ensureColumns 用 information_schema 判断缺列，只对缺失列执行 ADD COLUMN。
func ensureColumns(handle *sql.DB) error {
	for _, requirement := range requiredColumns {
		exists, err := columnExists(handle, requirement.table, requirement.column)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		statement := fmt.Sprintf("ALTER TABLE `%s` ADD COLUMN `%s` %s", requirement.table, requirement.column, requirement.definition)
		if _, err := handle.Exec(statement); err != nil {
			return fmt.Errorf("补齐列 %s.%s 失败：%w", requirement.table, requirement.column, err)
		}
	}
	return nil
}

func columnExists(handle *sql.DB, table, column string) (bool, error) {
	var count int
	err := handle.QueryRow(
		"SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
		table, column,
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("查询列信息失败：%w", err)
	}
	return count > 0, nil
}

// recordSchemaVersion 确保 schema_version 表里记录当前版本；重复启动不重复插入。
func recordSchemaVersion(handle *sql.DB) error {
	tx, err := handle.Begin()
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	var current sql.NullInt64
	if err := tx.QueryRow("SELECT MAX(version) FROM schema_version").Scan(&current); err != nil {
		return fmt.Errorf("读取 schema 版本失败：%w", err)
	}
	if !current.Valid {
		if _, err := tx.Exec("INSERT INTO schema_version (version) VALUES (?)", SchemaVersion); err != nil {
			return fmt.Errorf("写入 schema 版本失败：%w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}

// Meta 读取一个 meta 值；不存在返回空串与 false。
func (db *DB) Meta(key string) (string, bool, error) { return GetMeta(db.sql, key) }

// SetMeta 写入或覆盖一个 meta 值。
func (db *DB) SetMeta(key, value string) error { return SetMetaQ(db.sql, key, value) }

// Revision 读取当前 revision（缺省 0）。
func (db *DB) Revision() (int64, error) { return Revision(db.sql) }

// BumpRevision 自增 revision 并返回新值。
func (db *DB) BumpRevision() (int64, error) { return BumpRevisionQ(db.sql) }

// SchemaVersion 读取当前 schema 版本（schema_version 台账）。
func (db *DB) SchemaVersion() (int64, error) { return SchemaVersionQ(db.sql) }

// GetMeta 读取一个 meta 值；不存在返回空串与 false。可在事务内外复用。
func GetMeta(q Querier, key string) (string, bool, error) {
	var value string
	err := q.QueryRow("SELECT `value` FROM `meta` WHERE `key` = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

// SetMetaQ 写入或覆盖一个 meta 值。可在事务内外复用。
//
// `meta`.`key` / `meta`.`value` 是 MySQL 保留字，必须反引号限定。
func SetMetaQ(q Querier, key, value string) error {
	_, err := q.Exec(
		"INSERT INTO `meta` (`key`, `value`) VALUES (?, ?) AS new ON DUPLICATE KEY UPDATE `value` = new.`value`",
		key, value,
	)
	return err
}

// Revision 读取当前 revision（缺省 0）。
func Revision(q Querier) (int64, error) {
	raw, ok, err := GetMeta(q, "revision")
	if err != nil || !ok {
		return 0, err
	}
	return parseInt64(raw), nil
}

// BumpRevisionQ 自增 revision 并返回新值。
func BumpRevisionQ(q Querier) (int64, error) {
	next, err := Revision(q)
	if err != nil {
		return 0, err
	}
	next++
	if err := SetMetaQ(q, "revision", fmt.Sprintf("%d", next)); err != nil {
		return 0, err
	}
	return next, nil
}

// SchemaVersionQ 读取 schema_version 台账里的最高版本；空表返回 0。
func SchemaVersionQ(q Querier) (int64, error) {
	var version sql.NullInt64
	if err := q.QueryRow("SELECT MAX(version) FROM `schema_version`").Scan(&version); err != nil {
		return 0, err
	}
	if !version.Valid {
		return 0, nil
	}
	return version.Int64, nil
}

// Audit 写一条审计记录（失败不影响主流程，由调用方决定是否忽略）。
func (db *DB) Audit(at int64, actor, action string, detail *string) error {
	return AuditQ(db.sql, at, actor, action, detail)
}

// AuditQ 写一条审计记录；可在事务内外复用。
func AuditQ(q Querier, at int64, actor, action string, detail *string) error {
	var value any
	if detail != nil {
		value = *detail
	}
	_, err := q.Exec("INSERT INTO `audit` (`at`, `actor`, `action`, `detail`) VALUES (?, ?, ?, ?)", at, actor, action, value)
	return err
}

func parseInt64(raw string) int64 {
	var out int64
	for _, ch := range raw {
		if ch < '0' || ch > '9' {
			return 0
		}
		out = out*10 + int64(ch-'0')
	}
	return out
}
