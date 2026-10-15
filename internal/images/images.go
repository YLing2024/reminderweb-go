// Package images 负责卡片背景图字节的存取（旧 server/src/images.ts）。
//
// 背景图按文件名（basename，如 card-bg-20260101-120000-abcd.jpg）存，与前端
// IndexedDB 键 `reminderweb:image:<name>`、备份包内 `images/<name>` 对齐。
// 只存字节不解析图像；所有写入都应由调用方放在一个事务里。
package images

import (
	"database/sql"
	"errors"

	"reminderweb-go/internal/store"
)

// MaxImageBytes 单张图片字节上限（8 MiB）。
const MaxImageBytes = 8 * 1024 * 1024

// MaxImageNameLength 文件名长度上限。
const MaxImageNameLength = 200

// StoredImage 一张图片的名与字节。
type StoredImage struct {
	Name  string
	Bytes []byte
}

// IsValidImageName 判断合法图片名：非空、限长、不含路径分隔符与空字节、不含控制字符。
func IsValidImageName(name string) bool {
	if name == "" || len(name) > MaxImageNameLength {
		return false
	}
	if name == "." || name == ".." {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		if c == '/' || c == '\\' || c == 0 {
			return false
		}
		if c < 0x20 || c == 0x7f {
			return false
		}
	}
	return true
}

// ReadNames 读取全部图片名（升序）。
func ReadNames(q store.Querier) ([]string, error) {
	rows, err := q.Query("SELECT name FROM images ORDER BY name ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// 显式空切片：对外 JSON 必须是 []，不能是 null（旧实现恒为数组，前端据此直接 .length）。
	out := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

// ReadAll 读取全部图片字节（升序）。
func ReadAll(q store.Querier) ([]StoredImage, error) {
	rows, err := q.Query("SELECT name, bytes FROM images ORDER BY name ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// 与 ReadNames 同理：空集序列化为 []，避免 /api/data/full 出现 null。
	out := []StoredImage{}
	for rows.Next() {
		var name string
		var bytes []byte
		if err := rows.Scan(&name, &bytes); err != nil {
			return nil, err
		}
		out = append(out, StoredImage{Name: name, Bytes: bytes})
	}
	return out, rows.Err()
}

// Read 读取单张图片字节；不存在返回 nil,false。
func Read(q store.Querier, name string) ([]byte, bool, error) {
	var bytes []byte
	err := q.QueryRow("SELECT bytes FROM images WHERE name = ?", name).Scan(&bytes)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return bytes, true, nil
}

// Upsert 新增或覆盖单张图片（调用方负责事务与 revision）。
func Upsert(q store.Querier, name string, bytes []byte, at int64) error {
	_, err := q.Exec(
		"INSERT INTO images (name, bytes, updated_at) VALUES (?, ?, ?) AS new ON DUPLICATE KEY UPDATE bytes = new.bytes, updated_at = new.updated_at",
		name, bytes, at,
	)
	return err
}

// Delete 删除单张图片，返回是否实际删除。
func Delete(q store.Querier, name string) (bool, error) {
	result, err := q.Exec("DELETE FROM images WHERE name = ?", name)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

// ReplaceAll 用给定集合整体替换图片库（调用方负责事务）。
func ReplaceAll(q store.Querier, list []StoredImage, at int64) error {
	_, err := q.Exec("DELETE FROM images")
	if err != nil {
		return err
	}
	for _, image := range list {
		if err := Upsert(q, image.Name, image.Bytes, at); err != nil {
			return err
		}
	}
	return nil
}
