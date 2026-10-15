// Command migrate-sqlite-to-mysql 把旧 SQLite 的 reminderweb 库一次性搬到 MySQL。
//
// 这是独立的一次性迁移命令，不属于服务运行路径：本目录是独立的 Go module，
// 服务主程序（reminderweb-go）无法 import 它，反之它也不依赖服务代码。
//
// 行为约定：
//   - 源 SQLite 以只读方式打开，绝不写入；
//   - 目标 MySQL 建表复用 internal/store/schema.sql（与服务同一份权威 DDL），幂等；
//   - 写入用 INSERT ... ON DUPLICATE KEY UPDATE，重复执行收敛、不产生重复行；
//   - 每张表走「源计数 → 拷贝 → 目标计数 → 抽样比对」，任一不一致则非 0 退出；
//   - --dry-run 只看不写，--verify 只校验、不拷贝。
package main

import (
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/go-sql-driver/mysql"
	_ "modernc.org/sqlite"
)

type options struct {
	sqlitePath string
	dsn        string
	dryRun     bool
	verify     bool
	schemaPath string
	sample     int
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "迁移失败：%v\n", err)
		os.Exit(1)
	}
}

func parseFlags(args []string) (options, error) {
	var opts options
	fs := flag.NewFlagSet("migrate-sqlite-to-mysql", flag.ContinueOnError)
	fs.StringVar(&opts.sqlitePath, "sqlite", "", "旧 SQLite 库路径（只读）")
	fs.StringVar(&opts.dsn, "dsn", "", "目标 MySQL DSN（形如 user:pass@tcp(127.0.0.1:3306)/reminderweb）")
	fs.BoolVar(&opts.dryRun, "dry-run", false, "只看不写：统计源库并打印计划，不连接目标库")
	fs.BoolVar(&opts.verify, "verify", false, "只校验：不拷贝，比对源库与目标库的计数与抽样")
	fs.StringVar(&opts.schemaPath, "schema", "", "schema.sql 路径（默认自动查找 internal/store/schema.sql）")
	fs.IntVar(&opts.sample, "sample", 5, "每张表抽样比对的行数（从主键序前 N 行）")
	if err := fs.Parse(args); err != nil {
		return opts, err
	}
	if strings.TrimSpace(opts.sqlitePath) == "" {
		return opts, errors.New("必须用 --sqlite 指定旧 SQLite 库路径")
	}
	if !opts.dryRun && strings.TrimSpace(opts.dsn) == "" {
		return opts, errors.New("必须用 --dsn 指定目标 MySQL DSN（--dry-run 可省略）")
	}
	if opts.sample < 0 {
		return opts, errors.New("--sample 不能为负数")
	}
	if opts.schemaPath == "" {
		path, err := findSchema()
		if err != nil {
			return opts, err
		}
		opts.schemaPath = path
	}
	return opts, nil
}

func run(args []string) error {
	opts, err := parseFlags(args)
	if err != nil {
		return err
	}
	statements, err := loadStatements(opts.schemaPath)
	if err != nil {
		return err
	}

	source, err := openSQLiteReadOnly(opts.sqlitePath)
	if err != nil {
		return err
	}
	defer func() { _ = source.Close() }()

	if opts.dryRun {
		fmt.Printf("dry-run：schema=%s（%d 条建表语句），源库=%s\n", opts.schemaPath, len(statements), opts.sqlitePath)
		return reportSourceOnly(source, opts)
	}

	target, err := openMySQL(opts.dsn)
	if err != nil {
		return err
	}
	defer func() { _ = target.Close() }()

	if !opts.verify {
		if err := createSchema(target, statements); err != nil {
			return err
		}
	}

	return transfer(source, target, opts)
}

// findSchema 按常见工作目录查找权威 schema.sql（服务与工具共用同一份 DDL）。
func findSchema() (string, error) {
	candidates := []string{
		"internal/store/schema.sql",
		"../../internal/store/schema.sql",
		"../../../internal/store/schema.sql",
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", errors.New("找不到 internal/store/schema.sql，请用 --schema 显式指定")
}

// openSQLiteReadOnly 只读打开旧库，绝不写入源文件。
func openSQLiteReadOnly(path string) (*sql.DB, error) {
	handle, err := sql.Open("sqlite", "file:"+path+"?mode=ro&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite 失败：%w", err)
	}
	if err := handle.Ping(); err != nil {
		_ = handle.Close()
		return nil, fmt.Errorf("连接 SQLite 失败：%w", err)
	}
	return handle, nil
}

// openMySQL 连接目标库；DSN 由调用方提供（口令只在此出现，不落日志）。
func openMySQL(dsn string) (*sql.DB, error) {
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("解析目标 DSN 失败：%w", err)
	}
	if cfg.Collation == "" {
		cfg.Collation = "utf8mb4_0900_ai_ci"
	}
	handle, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return nil, fmt.Errorf("打开 MySQL 失败：%w", err)
	}
	if err := handle.Ping(); err != nil {
		_ = handle.Close()
		return nil, fmt.Errorf("连接 MySQL 失败：%w", err)
	}
	return handle, nil
}

// loadStatements 读取并切分 schema.sql；忽略 `--` 行注释。
func loadStatements(path string) ([]string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取 %s 失败：%w", path, err)
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
		statement := strings.TrimSpace(strings.Join(lines, "\n"))
		if statement != "" {
			out = append(out, statement)
		}
	}
	return out, nil
}

// createSchema 逐条执行 CREATE TABLE IF NOT EXISTS，可对空库与既有库重复执行。
func createSchema(target *sql.DB, statements []string) error {
	for _, statement := range statements {
		if _, err := target.Exec(statement); err != nil {
			return fmt.Errorf("建表失败：%w", err)
		}
	}
	return nil
}
