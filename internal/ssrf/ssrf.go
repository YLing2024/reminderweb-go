// Package ssrf 实现 SSRF 防护（旧 server/src/ssrf.ts）：默认拒绝指向回环 / 内网 /
// 链路本地 / 云元数据地址的目标；通过 WEBDAV_RELAY_ALLOW_PRIVATE=1 显式放开。
//
// 只做静态主机名 / 字面量 IP 判定，不做 DNS 解析（HTTP 客户端自行解析），
// 因此 DNS rebinding 不在本包覆盖范围内（见 README 说明）。
package ssrf

import (
	"net/url"
	"strings"
)

// TargetCheck 是目标校验结果。
type TargetCheck struct {
	OK bool
	// Reason 是不可用原因（中文，可直接展示）。
	Reason string
}

// blockedHostnames 是云元数据 / 特殊用途主机名黑名单。
var blockedHostnames = map[string]bool{
	"localhost":                true,
	"metadata":                 true,
	"metadata.google.internal": true,
	"metadata.goog":            true,
	"instance-data":            true,
	"kubernetes.default":       true,
	"kubernetes.default.svc":   true,
}

// ParseIPv4 解析 IPv4 字面量；非 IPv4 返回 nil。
func ParseIPv4(host string) []int {
	parts := strings.Split(host, ".")
	if len(parts) != 4 {
		return nil
	}
	out := make([]int, 0, 4)
	for _, part := range parts {
		if len(part) == 0 || len(part) > 3 {
			return nil
		}
		value := 0
		for _, ch := range part {
			if ch < '0' || ch > '9' {
				return nil
			}
			value = value*10 + int(ch-'0')
		}
		if value > 255 {
			return nil
		}
		out = append(out, value)
	}
	return out
}

// IsBlockedIPv4 判断是否为应被拒绝的 IPv4（回环 / 私网 / 链路本地 / 元数据等）。
func IsBlockedIPv4(ip []int) bool {
	a, b, c := ip[0], ip[1], ip[2]
	if a == 0 || a == 10 || a == 127 {
		return true
	}
	if a == 169 && b == 254 {
		return true
	}
	if a == 172 && b >= 16 && b <= 31 {
		return true
	}
	if a == 192 && b == 168 {
		return true
	}
	if a == 100 && b >= 64 && b <= 127 {
		return true
	}
	if a == 192 && b == 0 && c == 0 {
		return true
	}
	if a == 192 && b == 0 && c == 2 {
		return true
	}
	if a == 198 && (b == 18 || b == 19) {
		return true
	}
	return a >= 224
}

// IsBlockedIPv6 判断是否为应被拒绝的 IPv6 / IPv4 映射地址。纯字面量判断。
func IsBlockedIPv6(host string) bool {
	value := strings.ToLower(strings.TrimSpace(host))
	if value == "::1" || value == "::" {
		return true
	}
	if strings.HasPrefix(value, "::ffff:") {
		mapped := value[len("::ffff:"):]
		ip := ParseIPv4(mapped)
		if ip == nil {
			return true
		}
		return IsBlockedIPv4(ip)
	}
	for _, prefix := range []string{"fe8", "fe9", "fea", "feb"} {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	if strings.HasPrefix(value, "fc") || strings.HasPrefix(value, "fd") {
		return true
	}
	return strings.HasPrefix(value, "ff")
}

// CheckRelayTarget 校验目标地址是否允许转发。
func CheckRelayTarget(rawURL string, allowPrivate bool) TargetCheck {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" {
		return TargetCheck{OK: false, Reason: "目标地址格式不正确"}
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return TargetCheck{OK: false, Reason: "目标地址只支持 http 或 https"}
	}
	if allowPrivate {
		return TargetCheck{OK: true}
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return TargetCheck{OK: false, Reason: "目标地址缺少主机名"}
	}
	if blockedHostnames[host] || strings.HasSuffix(host, ".localhost") {
		return TargetCheck{OK: false, Reason: "目标地址指向本机 / 元数据服务，默认禁止"}
	}
	if ip := ParseIPv4(host); ip != nil {
		if IsBlockedIPv4(ip) {
			return TargetCheck{OK: false, Reason: "目标地址指向回环 / 内网 / 链路本地地址，默认禁止"}
		}
		return TargetCheck{OK: true}
	}
	if strings.Contains(host, ":") {
		if IsBlockedIPv6(host) {
			return TargetCheck{OK: false, Reason: "目标地址指向回环 / 内网 / 链路本地地址，默认禁止"}
		}
		return TargetCheck{OK: true}
	}
	return TargetCheck{OK: true}
}
