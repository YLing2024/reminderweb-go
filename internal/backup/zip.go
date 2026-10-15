// Package backup 实现与安卓版 / 前端互通的备份归档：zip 打包、AES 加密、metadata 形状映射。
//
// 硬约束（需求 §2）：加密参数、zip 内部结构、清单文件名一律照抄现有实现，保证
// 安卓导出能被本实现导入、本实现导出的能被安卓导入。本包只依赖标准库。
package backup

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"time"
)

// 归档约定的条目名（与安卓 / 前端逐字一致）。
const (
	// MetadataEntry 清单文件名。
	MetadataEntry = "metadata.json"
	// ImagesDir 图片目录前缀。
	ImagesDir = "images/"
)

// fixedModTime 写入 zip 的固定时间戳（2020-01-01 UTC），保证同一输入产出稳定。
var fixedModTime = time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)

// ZipEntry 是一个归档条目，保持调用方给定的顺序。
type ZipEntry struct {
	Name string
	Data []byte
}

// ZipCreate 打包为 zip。为与旧实现一致：压缩后不比原文小则改用 STORE，否则用 DEFLATE。
func ZipCreate(entries []ZipEntry) []byte {
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for _, entry := range entries {
		header := &zip.FileHeader{
			Name:     entry.Name,
			Method:   zip.Deflate,
			Modified: fixedModTime,
		}
		// 压缩率不划算时退回 STORE，行为对齐旧实现。
		if compressed := deflate(entry.Data); len(compressed) >= len(entry.Data) {
			header.Method = zip.Store
		}
		writer_, err := writer.CreateHeader(header)
		if err != nil {
			// 内存写入不会失败；保守起见保持空归档。
			continue
		}
		_, _ = writer_.Write(entry.Data)
	}
	_ = writer.Close()
	return buf.Bytes()
}

// ZipExtract 解压 zip，返回条目名 → 字节；非法结构返回错误。
func ZipExtract(data []byte) (map[string][]byte, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("不是有效的 zip：%w", err)
	}
	out := make(map[string][]byte, len(reader.File))
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			continue
		}
		handle, err := file.Open()
		if err != nil {
			return nil, fmt.Errorf("读取 zip 条目「%s」失败：%w", file.Name, err)
		}
		content, err := io.ReadAll(handle)
		_ = handle.Close()
		if err != nil {
			return nil, fmt.Errorf("解压 zip 条目「%s」失败：%w", file.Name, err)
		}
		out[file.Name] = content
	}
	return out, nil
}

// ErrEmptyArchive 表示数据短到无法构成 zip。
var ErrEmptyArchive = errors.New("不是有效的 zip：内容过短")

// IsZip 判断是否为明文 zip（"PK\x03\x04"）。
func IsZip(data []byte) bool {
	return len(data) >= 4 && data[0] == 0x50 && data[1] == 0x4b && data[2] == 0x03 && data[3] == 0x04
}
