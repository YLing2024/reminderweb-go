package main

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// rowReader 把一个 *sql.Rows 的一行读成 []any。
func scanRow(rows *sql.Rows, width int) ([]any, error) {
	values := make([]any, width)
	holders := make([]any, width)
	for i := range values {
		holders[i] = &values[i]
	}
	if err := rows.Scan(holders...); err != nil {
		return nil, err
	}
	return values, nil
}

// countRows 统计一张表的总行数。
func countRows(handle *sql.DB, spec tableSpec) (int64, error) {
	var total int64
	if err := handle.QueryRow(spec.countSQL()).Scan(&total); err != nil {
		return 0, fmt.Errorf("统计 %s 行数失败：%w", spec.name, err)
	}
	return total, nil
}

// copyTable 在一个事务里把源表原样写进目标表，返回写入行数。
func copyTable(source, target *sql.DB, spec tableSpec) (int64, error) {
	rows, err := source.Query(spec.selectSQL())
	if err != nil {
		return 0, fmt.Errorf("读取源表 %s 失败：%w", spec.name, err)
	}
	defer rows.Close()

	tx, err := target.Begin()
	if err != nil {
		return 0, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	statement, err := tx.Prepare(spec.insertSQL())
	if err != nil {
		return 0, fmt.Errorf("准备写入 %s 失败：%w", spec.name, err)
	}
	defer func() { _ = statement.Close() }()

	var written int64
	for rows.Next() {
		values, err := scanRow(rows, len(spec.columns))
		if err != nil {
			return 0, fmt.Errorf("读取 %s 行失败：%w", spec.name, err)
		}
		if _, err := statement.Exec(values...); err != nil {
			return 0, fmt.Errorf("写入 %s 失败：%w", spec.name, err)
		}
		written++
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("遍历源表 %s 失败：%w", spec.name, err)
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	committed = true
	return written, nil
}

// sampleRows 取按主键序的前 limit 行，做规范化后返回，供跨库比对。
func sampleRows(handle *sql.DB, spec tableSpec, limit int) ([]string, error) {
	query := spec.selectSQL()
	if limit > 0 {
		query += " LIMIT " + strconv.Itoa(limit)
	}
	rows, err := handle.Query(query)
	if err != nil {
		return nil, fmt.Errorf("抽样 %s 失败：%w", spec.name, err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		values, err := scanRow(rows, len(spec.columns))
		if err != nil {
			return nil, fmt.Errorf("抽样 %s 行失败：%w", spec.name, err)
		}
		out = append(out, canonicalRow(values))
	}
	return out, rows.Err()
}

// canonicalRow 把一行规范化成可跨驱动比较的串：SQLite 文本是 string、MySQL 文本是
// []byte，整型在两边都是 int64；统一按单元格长度前缀拼接，避免分隔符歧义。
func canonicalRow(values []any) string {
	var builder strings.Builder
	for _, value := range values {
		cell := canonicalValue(value)
		fmt.Fprintf(&builder, "%d:%s|", len(cell), cell)
	}
	return builder.String()
}

func canonicalValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return "<NULL>"
	case []byte:
		return string(typed)
	case string:
		return typed
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		return strconv.FormatFloat(typed, 'g', -1, 64)
	case bool:
		return strconv.FormatBool(typed)
	default:
		return fmt.Sprintf("%v", typed)
	}
}

// reportSourceOnly 用于 --dry-run：只读源库，打印每张表将搬迁的行数。
func reportSourceOnly(source *sql.DB, opts options) error {
	fmt.Printf("%-12s %10s\n", "表", "源行数")
	for _, spec := range tables {
		total, err := countRows(source, spec)
		if err != nil {
			return err
		}
		fmt.Printf("%-12s %10d\n", spec.name, total)
	}
	fmt.Println("dry-run 结束：未连接、未写入任何 MySQL。")
	return nil
}

// transfer 逐表「源计数 → 拷贝 → 目标计数 → 抽样比对」；--verify 时跳过拷贝。
func transfer(source, target *sql.DB, opts options) error {
	fmt.Printf("%-12s %10s %10s %8s %8s\n", "表", "源行数", "目标行数", "抽样", "结果")
	mismatched := false
	for _, spec := range tables {
		sourceCount, err := countRows(source, spec)
		if err != nil {
			return err
		}
		if !opts.verify {
			if _, err := copyTable(source, target, spec); err != nil {
				return err
			}
		}
		targetCount, err := countRows(target, spec)
		if err != nil {
			return err
		}

		sourceSample, err := sampleRows(source, spec, opts.sample)
		if err != nil {
			return err
		}
		targetSample, err := sampleRows(target, spec, opts.sample)
		if err != nil {
			return err
		}
		sampleOK := equalSamples(sourceSample, targetSample)

		result := "一致"
		if sourceCount != targetCount || !sampleOK {
			result = "不一致"
			mismatched = true
		}
		fmt.Printf("%-12s %10d %10d %8d %8s\n", spec.name, sourceCount, targetCount, len(sourceSample), result)
		if !sampleOK {
			fmt.Printf("  %s 抽样不一致：源 %v / 目标 %v\n", spec.name, sourceSample, targetSample)
		}
	}
	if mismatched {
		return errors.New("存在计数或抽样不一致的表，请检查上面的明细")
	}
	if opts.verify {
		fmt.Println("verify 结束：源库与目标库逐表计数与抽样一致。")
	} else {
		fmt.Println("迁移结束：源库与目标库逐表计数与抽样一致。")
	}
	return nil
}

func equalSamples(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
