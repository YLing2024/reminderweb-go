// Package store 负责 SQLite 的打开、建表迁移与 PRAGMA 设置，并封装 meta / revision / audit。
//
// schema、表结构与 PRAGMA（journal_mode=WAL、foreign_keys=ON、busy_timeout=5000）必须与旧 Node
// 实现（server/src/db.ts）逐字一致：既有 reminder.db 必须能被直接打开读写，不要求重新导入、不得改表。
package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// SchemaVersion 当前 schema 版本，写入 meta.schema_version。
const SchemaVersion = 1

// DBFileName 数据目录下的数据库文件名。
const DBFileName = "reminder.db"

const schemaSQL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tags      (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings  (k TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS images    (name TEXT PRIMARY KEY, bytes BLOB NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions  (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS users     (username TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit     (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT);
`

// DB 是一次 SQLite 打开会话。
type DB struct {
	sql *sql.DB
}

// Querier 抽象 *sql.DB 与 *sql.Tx，便于同一套读写函数在事务内外复用。
type Querier interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

// SQL 暴露底层句柄，供各业务层在同一连接上执行读写。
func (db *DB) SQL() *sql.DB { return db.sql }

// Close 关闭数据库。
func (db *DB) Close() error { return db.sql.Close() }

// Open 打开数据目录下的 reminder.db（自动建目录、设 PRAGMA、建表）。
func Open(dataDir string) (*DB, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("创建数据目录失败：%w", err)
	}
	return OpenPath(filepath.Join(dataDir, DBFileName))
}

// OpenPath 打开指定路径的数据库；`:memory:` 用于测试。
func OpenPath(path string) (*DB, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, fmt.Errorf("创建数据库目录失败：%w", err)
		}
	}
	dsn := "file:" + path + "?_pragma=busy_timeout(5000)"
	if path == ":memory:" {
		dsn = "file::memory:?_pragma=busy_timeout(5000)"
	}
	handle, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("打开数据库失败：%w", err)
	}
	// 单连接串行化：与旧 Node 的单 DatabaseSync 语义一致，避免 WAL 下的写锁竞争。
	handle.SetMaxOpenConns(1)
	handle.SetMaxIdleConns(1)
	if err := configure(handle); err != nil {
		_ = handle.Close()
		return nil, err
	}
	db := &DB{sql: handle}
	if err := migrate(db); err != nil {
		_ = handle.Close()
		return nil, err
	}
	if path != ":memory:" {
		// 既有数据的读写权限收紧到 0600（含 WAL/SHM 侧车文件）。
		for _, suffix := range []string{"", "-wal", "-shm"} {
			_ = os.Chmod(path+suffix, 0o600)
		}
	}
	return db, nil
}

func configure(handle *sql.DB) error {
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL;",
		"PRAGMA foreign_keys=ON;",
		"PRAGMA busy_timeout=5000;",
	} {
		if _, err := handle.Exec(pragma); err != nil {
			return fmt.Errorf("设置 %s 失败：%w", pragma, err)
		}
	}
	return nil
}

func migrate(db *DB) error {
	if _, err := db.sql.Exec(schemaSQL); err != nil {
		return fmt.Errorf("建表失败：%w", err)
	}
	if _, err := db.sql.Exec(
		"INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?), (?, ?)",
		"schema_version", fmt.Sprintf("%d", SchemaVersion), "revision", "0",
	); err != nil {
		return fmt.Errorf("初始化 meta 失败：%w", err)
	}
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

// SchemaVersion 读取当前 schema 版本。
func (db *DB) SchemaVersion() (int64, error) { return SchemaVersionQ(db.sql) }

// GetMeta 读取一个 meta 值；不存在返回空串与 false。可在事务内外复用。
func GetMeta(q Querier, key string) (string, bool, error) {
	var value string
	err := q.QueryRow("SELECT value FROM meta WHERE key = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

// SetMetaQ 写入或覆盖一个 meta 值。可在事务内外复用。
func SetMetaQ(q Querier, key, value string) error {
	_, err := q.Exec(
		"INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
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

// SchemaVersionQ 读取当前 schema 版本。
func SchemaVersionQ(q Querier) (int64, error) {
	raw, ok, err := GetMeta(q, "schema_version")
	if err != nil || !ok {
		return 0, err
	}
	return parseInt64(raw), nil
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
	_, err := q.Exec("INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)", at, actor, action, value)
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
