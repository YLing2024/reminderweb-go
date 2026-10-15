package webdav

import "encoding/base64"

func base64Std(data []byte) string { return base64.StdEncoding.EncodeToString(data) }

// encodeURIComponentUnreserved 是 JavaScript encodeURIComponent 不转义的字符集。
func isUnreserved(b byte) bool {
	switch {
	case b >= 'A' && b <= 'Z', b >= 'a' && b <= 'z', b >= '0' && b <= '9':
		return true
	case b == '-', b == '_', b == '.', b == '!', b == '~', b == '*', b == '\'', b == '(', b == ')':
		return true
	}
	return false
}

const hexDigits = "0123456789ABCDEF"

// encodeURIComponent 复刻 JavaScript encodeURIComponent（UTF-8 百分号编码）。
func encodeURIComponent(value string) string {
	var builder []byte
	for i := 0; i < len(value); i++ {
		b := value[i]
		if isUnreserved(b) {
			builder = append(builder, b)
			continue
		}
		builder = append(builder, '%', hexDigits[b>>4], hexDigits[b&0x0f])
	}
	return string(builder)
}
