// Package scrypt 是 RFC 7914 scrypt 的纯标准库实现。
//
// 为什么自己实现而不引 golang.org/x/crypto：本重写只允许 `modernc.org/sqlite` 与
// `gopkg.in/yaml.v3` 两个第三方依赖，而既有 users 表里的口令哈希是旧 Node 实现用
// crypto.scrypt(N=16384,r=8,p=1,keyLen=32) 生成的，必须能原样校验，因此需要 scrypt。
// 实现只依赖 crypto/sha256 与 crypto/hmac，参数与旧实现对齐。
package scrypt

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"errors"
)

// 默认参数，与旧实现 server/src/auth.ts 的 SCRYPT_PARAMS 完全一致。
const (
	defaultN    = 16384
	defaultR    = 8
	defaultP    = 1
	defaultLen  = 32
	salsaRounds = 8
)

// Derive 用与旧实现一致的参数生成 keyLen 字节密钥。
func Derive(password string, salt []byte, keyLen int) []byte {
	return DeriveWithParams(password, salt, defaultN, defaultR, defaultP, keyLen)
}

// KeyLen 返回旧实现使用的派生密钥长度（32 字节）。
func KeyLen() int { return defaultLen }

// DeriveWithParams 按给定参数派生密钥；参数非法返回 nil。
// 参数校验沿用 RFC 7914 的约束（N 为 2 的幂且 > 1，r*p < 2^30）。
func DeriveWithParams(password string, salt []byte, n, r, p, keyLen int) []byte {
	if n <= 1 || n&(n-1) != 0 || r <= 0 || p <= 0 || keyLen <= 0 {
		return nil
	}
	if uint64(r)*uint64(p) >= 1<<30 {
		return nil
	}
	blockWords := 32 * r
	// B = PBKDF2-HMAC-SHA256(password, salt, 1, p*128*r)
	b := pbkdf2SHA256([]byte(password), salt, 1, p*128*r)
	words := bytesToWords(b)

	x := make([]uint32, blockWords)
	y := make([]uint32, blockWords)
	v := make([]uint32, blockWords*n)
	var tmp [16]uint32
	for i := 0; i < p; i++ {
		offset := i * blockWords
		copy(x, words[offset:offset+blockWords])
		roMix(x, y, v, &tmp, r, n)
		copy(words[offset:offset+blockWords], x)
	}
	return pbkdf2SHA256([]byte(password), wordsToBytes(words), 1, keyLen)
}

// roMix 是 RFC 7914 的 ROMix：先填充 V 表，再按 Integerify 抽取异或，始终走 BlockMix。
func roMix(x, y, v []uint32, tmp *[16]uint32, r, n int) {
	blockWords := 32 * r
	for i := 0; i < n; i++ {
		copy(v[i*blockWords:], x)
		blockMix(y, x, tmp, r)
		x, y = y, x
	}
	for i := 0; i < n; i++ {
		j := integerify(x, r) % uint64(n)
		base := int(j) * blockWords
		for k := range x {
			x[k] ^= v[base+k]
		}
		blockMix(y, x, tmp, r)
		x, y = y, x
	}
}

// blockMix 计算 B' = BlockMix(B)：对 2r 个 64 字节块做 Salsa20/8 链，再按
// (Y0, Y2, …, Y_{2r-2}, Y1, Y3, …, Y_{2r-1}) 重排。
func blockMix(out, in []uint32, tmp *[16]uint32, r int) {
	copy(tmp[:], in[(2*r-1)*16:2*r*16])
	for i := 0; i < 2*r; i++ {
		for k := 0; k < 16; k++ {
			tmp[k] ^= in[i*16+k]
		}
		salsa8(tmp)
		dst := (i / 2) * 16
		if i%2 == 1 {
			dst = (r + i/2) * 16
		}
		copy(out[dst:dst+16], tmp[:])
	}
}

// integerify 取最后一个 64 字节块的低 64 位（小端）。
func integerify(x []uint32, r int) uint64 {
	base := (2*r - 1) * 16
	return uint64(x[base]) | uint64(x[base+1])<<32
}

func bytesToWords(b []byte) []uint32 {
	words := make([]uint32, len(b)/4)
	for i := range words {
		words[i] = binary.LittleEndian.Uint32(b[i*4:])
	}
	return words
}

func wordsToBytes(words []uint32) []byte {
	out := make([]byte, len(words)*4)
	for i, w := range words {
		binary.LittleEndian.PutUint32(out[i*4:], w)
	}
	return out
}

func rotl(v uint32, n uint) uint32 { return v<<n | v>>(32-n) }

// salsa8 是 Salsa20/8 核心（4 个双轮），用 XOR-加法复合，与 scrypt 规范一致。
func salsa8(block *[16]uint32) {
	x := *block
	for i := 0; i < salsaRounds; i += 2 {
		x[4] ^= rotl(x[0]+x[12], 7)
		x[8] ^= rotl(x[4]+x[0], 9)
		x[12] ^= rotl(x[8]+x[4], 13)
		x[0] ^= rotl(x[12]+x[8], 18)
		x[9] ^= rotl(x[5]+x[1], 7)
		x[13] ^= rotl(x[9]+x[5], 9)
		x[1] ^= rotl(x[13]+x[9], 13)
		x[5] ^= rotl(x[1]+x[13], 18)
		x[14] ^= rotl(x[10]+x[6], 7)
		x[2] ^= rotl(x[14]+x[10], 9)
		x[6] ^= rotl(x[2]+x[14], 13)
		x[10] ^= rotl(x[6]+x[2], 18)
		x[3] ^= rotl(x[15]+x[11], 7)
		x[7] ^= rotl(x[3]+x[15], 9)
		x[11] ^= rotl(x[7]+x[3], 13)
		x[15] ^= rotl(x[11]+x[7], 18)

		x[1] ^= rotl(x[0]+x[3], 7)
		x[2] ^= rotl(x[1]+x[0], 9)
		x[3] ^= rotl(x[2]+x[1], 13)
		x[0] ^= rotl(x[3]+x[2], 18)
		x[6] ^= rotl(x[5]+x[4], 7)
		x[7] ^= rotl(x[6]+x[5], 9)
		x[4] ^= rotl(x[7]+x[6], 13)
		x[5] ^= rotl(x[4]+x[7], 18)
		x[11] ^= rotl(x[10]+x[9], 7)
		x[8] ^= rotl(x[11]+x[10], 9)
		x[9] ^= rotl(x[8]+x[11], 13)
		x[10] ^= rotl(x[9]+x[8], 18)
		x[12] ^= rotl(x[15]+x[14], 7)
		x[13] ^= rotl(x[12]+x[15], 9)
		x[14] ^= rotl(x[13]+x[12], 13)
		x[15] ^= rotl(x[14]+x[13], 18)
	}
	for i := range x {
		block[i] += x[i]
	}
}

// pbkdf2SHA256 是 RFC 2898 PBKDF2-HMAC-SHA256；scrypt 只用 iteration=1，但保留通用形式。
func pbkdf2SHA256(password, salt []byte, iter, keyLen int) []byte {
	if iter < 1 || keyLen <= 0 {
		return nil
	}
	prf := hmac.New(sha256.New, password)
	hashLen := prf.Size()
	numBlocks := (keyLen + hashLen - 1) / hashLen
	dk := make([]byte, 0, numBlocks*hashLen)
	u := make([]byte, hashLen)
	var counter [4]byte
	for block := 1; block <= numBlocks; block++ {
		prf.Reset()
		_, _ = prf.Write(salt)
		binary.BigEndian.PutUint32(counter[:], uint32(block))
		_, _ = prf.Write(counter[:])
		u = prf.Sum(u[:0])
		t := make([]byte, hashLen)
		copy(t, u)
		for n := 2; n <= iter; n++ {
			prf.Reset()
			_, _ = prf.Write(u)
			u = prf.Sum(u[:0])
			for i := range t {
				t[i] ^= u[i]
			}
		}
		dk = append(dk, t...)
	}
	return dk[:keyLen]
}

// ErrInvalidParams 参数非法。
var ErrInvalidParams = errors.New("scrypt 参数非法")
