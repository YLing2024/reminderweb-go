package scrypt

import (
	"encoding/hex"
	"testing"
)

// RFC 7914 §12 的官方测试向量，用于证明实现正确（改坏任意一行都会红）。
func TestRFC7914Vectors(t *testing.T) {
	cases := []struct {
		name     string
		password string
		salt     string
		n, r, p  int
		keyLen   int
		wantHex  string
	}{
		{
			name: "vector1", password: "", salt: "", n: 16, r: 1, p: 1, keyLen: 64,
			wantHex: "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442" +
				"fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906",
		},
		{
			name: "vector2", password: "password", salt: "NaCl", n: 1024, r: 8, p: 16, keyLen: 64,
			wantHex: "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b373162" +
				"2eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640",
		},
		{
			name: "vector3", password: "pleaseletmein", salt: "SodiumChloride", n: 16384, r: 8, p: 1, keyLen: 64,
			wantHex: "7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2" +
				"d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := DeriveWithParams(tc.password, []byte(tc.salt), tc.n, tc.r, tc.p, tc.keyLen)
			if got == nil {
				t.Fatal("派生返回 nil")
			}
			if hex.EncodeToString(got) != tc.wantHex {
				t.Fatalf("密钥不匹配\n got=%s\nwant=%s", hex.EncodeToString(got), tc.wantHex)
			}
		})
	}
}

func TestDeriveParamsMatchProduction(t *testing.T) {
	// 生产参数：N=16384,r=8,p=1,keyLen=32；同一输入必须稳定且非空。
	a := Derive("secret-passphrase", []byte("0123456789abcdef"), KeyLen())
	b := Derive("secret-passphrase", []byte("0123456789abcdef"), KeyLen())
	if len(a) != 32 {
		t.Fatalf("密钥长度应为 32，实际 %d", len(a))
	}
	if hex.EncodeToString(a) != hex.EncodeToString(b) {
		t.Fatal("同一输入应得到同一密钥")
	}
	if hex.EncodeToString(a) == hex.EncodeToString(Derive("wrong", []byte("0123456789abcdef"), KeyLen())) {
		t.Fatal("不同口令不应得到同一密钥")
	}
}

func TestDeriveInvalidParams(t *testing.T) {
	if DeriveWithParams("x", []byte("y"), 3, 8, 1, 32) != nil {
		t.Fatal("N 非 2 的幂应返回 nil")
	}
	if DeriveWithParams("x", []byte("y"), 16, 0, 1, 32) != nil {
		t.Fatal("r<=0 应返回 nil")
	}
}
