package backup

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"errors"
)

// obfuscatedKey 上游 BackupEncryptor.kt 的 40 字节混淆常量。
//
// 必须与前端 src/lib/backup.ts 的 OBFUSCATED_KEY 逐字节一致：任何一个字节漂移都会
// 让安卓加密备份无法解开。由本包测试交叉断言。
var obfuscatedKey = []byte{
	40, 63, 55, 51, 52, 62, 63, 40, 41, 63, 57, 47, 40, 63, 124, 59, 57, 49, 47, 34, 41, 63, 63, 62, 44, 59, 54, 47, 63, 37,
	104, 106, 104, 110, 37, 35, 56, 62, 61, 54,
}

const ivLength = 16

// ObfuscatedKey 返回混淆常量的副本（只暴露字节，不暴露派生密钥）。
func ObfuscatedKey() []byte {
	out := make([]byte, len(obfuscatedKey))
	copy(out, obfuscatedKey)
	return out
}

// deriveKey 生成整包密钥：seed[i] = obfuscated[i] XOR 90，再取 SHA-256。
func deriveKey() []byte {
	seed := make([]byte, len(obfuscatedKey))
	for i, b := range obfuscatedKey {
		seed[i] = b ^ 90
	}
	sum := sha256.Sum256(seed)
	return sum[:]
}

// EncryptArchive 整包加密，返回 [16 字节随机 IV][密文]（AES-256-CBC + PKCS7）。
func EncryptArchive(zipBytes []byte) ([]byte, error) {
	block, err := aes.NewCipher(deriveKey())
	if err != nil {
		return nil, err
	}
	iv := make([]byte, ivLength)
	if _, err := rand.Read(iv); err != nil {
		return nil, err
	}
	padded := pkcs7Pad(zipBytes, aes.BlockSize)
	out := make([]byte, ivLength+len(padded))
	copy(out, iv)
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out[ivLength:], padded)
	return out, nil
}

// DecryptArchive 解密整包；失败返回 nil（调用方据此回退到明文 zip）。
func DecryptArchive(data []byte) []byte {
	if len(data) <= ivLength {
		return nil
	}
	block, err := aes.NewCipher(deriveKey())
	if err != nil {
		return nil
	}
	body := data[ivLength:]
	if len(body) == 0 || len(body)%aes.BlockSize != 0 {
		return nil
	}
	plain := make([]byte, len(body))
	cipher.NewCBCDecrypter(block, data[:ivLength]).CryptBlocks(plain, body)
	unpadded, err := pkcs7Unpad(plain, aes.BlockSize)
	if err != nil {
		return nil
	}
	return unpadded
}

func pkcs7Pad(data []byte, blockSize int) []byte {
	pad := blockSize - len(data)%blockSize
	out := make([]byte, len(data)+pad)
	copy(out, data)
	for i := len(data); i < len(out); i++ {
		out[i] = byte(pad)
	}
	return out
}

func pkcs7Unpad(data []byte, blockSize int) ([]byte, error) {
	if len(data) == 0 || len(data)%blockSize != 0 {
		return nil, errors.New("padding 长度非法")
	}
	pad := int(data[len(data)-1])
	if pad == 0 || pad > blockSize || pad > len(data) {
		return nil, errors.New("padding 值非法")
	}
	for _, b := range data[len(data)-pad:] {
		if int(b) != pad {
			return nil, errors.New("padding 校验失败")
		}
	}
	return data[:len(data)-pad], nil
}
