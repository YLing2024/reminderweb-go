package backup

import (
	"bytes"
	"compress/flate"
)

// deflate 计算 DEFLATE 后的字节，用于判断 STORE / DEFLATE 的选择（与旧实现一致）。
func deflate(data []byte) []byte {
	var buf bytes.Buffer
	writer, err := flate.NewWriter(&buf, flate.DefaultCompression)
	if err != nil {
		return nil
	}
	if _, err := writer.Write(data); err != nil {
		_ = writer.Close()
		return nil
	}
	if err := writer.Close(); err != nil {
		return nil
	}
	return buf.Bytes()
}
