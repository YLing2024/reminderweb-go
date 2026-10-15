package ssrf

import "testing"

func TestCheckRelayTarget(t *testing.T) {
	cases := []struct {
		name         string
		url          string
		allowPrivate bool
		wantOK       bool
	}{
		{"公网 https", "https://dav.example.com/dav/", false, true},
		{"公网 http", "http://dav.example.com/dav/", false, true},
		{"回环 IPv4", "http://127.0.0.1:8080/dav/", false, false},
		{"私网 192.168", "http://192.168.1.5/dav/", false, false},
		{"私网 10.", "http://10.0.0.9/dav/", false, false},
		{"私网 172.16", "http://172.16.3.4/dav/", false, false},
		{"链路本地", "http://169.254.1.1/", false, false},
		{"元数据主机名", "http://metadata.google.internal/", false, false},
		{"localhost", "http://localhost/dav/", false, false},
		{"回环 IPv6", "http://[::1]/dav/", false, false},
		{"非 http(s)", "ftp://dav.example.com/", false, false},
		{"缺协议", "dav.example.com", false, false},
		{"允许内网时放行回环", "http://127.0.0.1:8080/dav/", true, true},
		{"允许内网时仍限协议", "ftp://x/", true, false},
	}
	for _, tc := range cases {
		got := CheckRelayTarget(tc.url, tc.allowPrivate)
		if got.OK != tc.wantOK {
			t.Errorf("%s：CheckRelayTarget(%q, %v).OK = %v，期望 %v（原因：%s）",
				tc.name, tc.url, tc.allowPrivate, got.OK, tc.wantOK, got.Reason)
		}
	}
}

func TestBlockedIPv4Ranges(t *testing.T) {
	blocked := []string{"0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.0.1", "172.31.255.255", "192.168.0.1", "100.64.0.1", "198.18.0.1", "224.0.0.1"}
	for _, host := range blocked {
		ip := ParseIPv4(host)
		if ip == nil || !IsBlockedIPv4(ip) {
			t.Errorf("%s 应被判为受限", host)
		}
	}
	for _, host := range []string{"8.8.8.8", "203.0.113.5", "93.184.216.34"} {
		ip := ParseIPv4(host)
		if ip == nil || IsBlockedIPv4(ip) {
			t.Errorf("%s 不应被判为受限", host)
		}
	}
}
