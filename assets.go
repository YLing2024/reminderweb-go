// Package reminderweb 承载嵌入式前端产物，供二进制自带前端形态使用。
package reminderweb

import (
	"embed"
	"io/fs"
)

// distFS 嵌入构建产物目录；以 all: 前缀包含点文件与下划线开头的文件。
//
//go:embed all:web/dist
var distFS embed.FS

// DistFS 返回定位到 dist 根的文件系统。
func DistFS() fs.FS {
	sub, err := fs.Sub(distFS, "web/dist")
	if err != nil {
		return distFS
	}
	return sub
}
