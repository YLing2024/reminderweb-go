// Package webdav 实现服务端 WebDAV 客户端（旧 server/src/webdav.ts）。
//
// 纯 net/http + 正则 XML 解析，零第三方依赖。支持 PROPFIND(Depth:1) / MKCOL / PUT / GET / DELETE
// 与 Basic 认证；所有对外错误均为 *Error，Message 已是可直接展示（并脱敏）的中文文案。
// 凭据只从配置读取，不进入日志、URL 或错误信息。
package webdav

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"reminderweb-go/internal/config"
)

// BackupFilePrefix 是本应用备份文件名前缀。
const BackupFilePrefix = "reminder-backup-"

// Config 是 WebDAV 客户端连接配置。
type Config struct {
	URL       string
	Username  string
	Password  string
	TimeoutMS int
}

// RemoteFile 是远端一个备份文件的元信息。
type RemoteFile struct {
	Name         string
	Size         int64
	LastModified int64
	ETag         string
}

// ErrorCode 是 WebDAV 错误码。
type ErrorCode string

// 错误码取值。
const (
	CodeInvalidURL ErrorCode = "INVALID_URL"
	CodeAuth       ErrorCode = "AUTH"
	CodeNotFound   ErrorCode = "NOT_FOUND"
	CodeNotWebdav  ErrorCode = "NOT_WEBDAV"
	CodeNetwork    ErrorCode = "NETWORK"
	CodeTimeout    ErrorCode = "TIMEOUT"
	CodeHTTP       ErrorCode = "HTTP"
)

// Error 是 WebDAV 客户端错误。
type Error struct {
	Code    ErrorCode
	Message string
	Status  int
}

func (e *Error) Error() string { return e.Message }

// Deps 注入外部依赖（测试用假 WebDAV 服务）。
type Deps struct {
	Client *http.Client
}

// FromConfig 由后端配置构造客户端配置（凭据只来自环境变量 / 库设置）。
func FromConfig(cfg *config.Config) Config {
	return Config{
		URL:       cfg.WebDAVURL,
		Username:  cfg.WebDAVUsername,
		Password:  cfg.WebDAVPassword,
		TimeoutMS: cfg.WebDAVTimeoutSeconds * 1000,
	}
}

// ConfigWith 由最长前缀构建带库设置的客户端配置。
func ConfigWith(baseURL, username, password string, timeoutMS int) Config {
	return Config{URL: baseURL, Username: username, Password: password, TimeoutMS: timeoutMS}
}

var schemeRe = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*://`)

// NormalizeBaseURL 规范化目录地址：补协议、补尾斜杠、去 hash、剥离 URL 内嵌凭据。
func NormalizeBaseURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", &Error{Code: CodeInvalidURL, Message: "WebDAV 地址不能为空"}
	}
	withScheme := trimmed
	if !schemeRe.MatchString(trimmed) {
		withScheme = "https://" + trimmed
	}
	parsed, err := url.Parse(withScheme)
	if err != nil {
		return "", &Error{Code: CodeInvalidURL, Message: "WebDAV 地址格式不正确"}
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", &Error{Code: CodeInvalidURL, Message: "WebDAV 地址需以 http 或 https 开头"}
	}
	parsed.User = nil
	parsed.Fragment = ""
	if !strings.HasSuffix(parsed.Path, "/") {
		parsed.Path += "/"
	}
	return parsed.String(), nil
}

// JoinURL 拼接 base 目录与文件名（文件名做 URL 编码）。
func JoinURL(base, name string) string {
	return base + encodeURIComponent(name)
}

// BuildAuthHeader 生成 Basic 认证头；用 UTF-8 → Base64，兼容中文口令。
func BuildAuthHeader(username, password string) string {
	return "Basic " + base64Std([]byte(username+":"+password))
}

// IsBackupName 判断是否为本应用产生的备份文件名。
func IsBackupName(name string) bool {
	return strings.HasPrefix(name, BackupFilePrefix) && strings.HasSuffix(strings.ToLower(name), ".zip")
}

var backupNameRe = regexp.MustCompile(`^reminder-backup-\d{8}-\d{6}\.zip$`)

// IsValidBackupName 判断是否为严格合法的备份文件名。
func IsValidBackupName(name string) bool { return backupNameRe.MatchString(name) }

// FileNameFromHref 从 href 取 basename（去查询串并解码）。
func FileNameFromHref(href string) string {
	path := href
	if index := strings.IndexAny(path, "?#"); index >= 0 {
		path = path[:index]
	}
	path = strings.TrimSuffix(path, "/")
	last := path
	if index := strings.LastIndex(path, "/"); index >= 0 {
		last = path[index+1:]
	}
	if decoded, err := url.PathUnescape(last); err == nil {
		return decoded
	}
	return last
}

func decodeEntities(value string) string {
	replacer := strings.NewReplacer(
		"&lt;", "<",
		"&gt;", ">",
		"&quot;", "\"",
		"&#39;", "'",
		"&amp;", "&",
	)
	return replacer.Replace(value)
}

func extractTag(block, name string) (string, bool) {
	pattern := regexp.MustCompile(`(?is)<(?:[\w-]+:)?` + name + `\b[^>]*>(.*?)</(?:[\w-]+:)?` + name + `>`)
	match := pattern.FindStringSubmatch(block)
	if match == nil {
		return "", false
	}
	return decodeEntities(strings.TrimSpace(match[1])), true
}

var responseRe = regexp.MustCompile(`(?is)<(?:[\w-]+:)?response\b[^>]*>(.*?)</(?:[\w-]+:)?response>`)

// ParsePropfind 解析 PROPFIND 响应：只留本应用 *.zip，按最后修改时间倒序。
func ParsePropfind(xmlText string) []RemoteFile {
	byName := map[string]RemoteFile{}
	for _, match := range responseRe.FindAllStringSubmatch(xmlText, -1) {
		block := match[1]
		href, ok := extractTag(block, "href")
		if !ok || href == "" {
			continue
		}
		name := FileNameFromHref(href)
		if !IsBackupName(name) {
			continue
		}
		size := int64(0)
		if raw, ok := extractTag(block, "getcontentlength"); ok {
			if parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64); err == nil {
				size = parsed
			}
		}
		modified := int64(0)
		if raw, ok := extractTag(block, "getlastmodified"); ok {
			if parsed, err := http.ParseTime(raw); err == nil {
				modified = parsed.UnixMilli()
			}
		}
		etag := ""
		if raw, ok := extractTag(block, "getetag"); ok && raw != "" {
			etag = raw
		}
		byName[name] = RemoteFile{Name: name, Size: size, LastModified: modified, ETag: etag}
	}
	out := make([]RemoteFile, 0, len(byName))
	for _, file := range byName {
		out = append(out, file)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].LastModified != out[j].LastModified {
			return out[i].LastModified > out[j].LastModified
		}
		return out[i].Name > out[j].Name
	})
	return out
}

// MapHTTPError 把 HTTP 状态码映射为中文错误。
func MapHTTPError(status int) *Error {
	switch status {
	case 401, 403:
		return &Error{Code: CodeAuth, Message: "用户名或密码不正确，或该账号无权访问此目录", Status: status}
	case 404:
		return &Error{Code: CodeNotFound, Message: "地址不对，服务器上找不到该路径", Status: status}
	case 405:
		return &Error{Code: CodeNotWebdav, Message: "该地址不像 WebDAV 服务（服务器拒绝了 PROPFIND）", Status: status}
	}
	return &Error{Code: CodeHTTP, Message: fmt.Sprintf("服务器返回 %d", status), Status: status}
}

// mapFetchError 把底层传输错误映射为可展示的中文文案，尽量区分超时 / DNS / 证书 / 连接失败。
func mapFetchError(err error) *Error {
	var webdavErr *Error
	if errors.As(err, &webdavErr) {
		return webdavErr
	}
	// 超时：context 截止或底层 net.Error 超时。
	if errors.Is(err, context.DeadlineExceeded) {
		return &Error{Code: CodeTimeout, Message: "连接超时，请检查地址与网络"}
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return &Error{Code: CodeTimeout, Message: "连接超时，请检查地址与网络"}
	}
	// 主动取消（进程退出或上层取消）与真正的网络故障区分开。
	if errors.Is(err, context.Canceled) {
		return &Error{Code: CodeNetwork, Message: "请求被中断，请稍后重试"}
	}
	// DNS 解析失败。
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return &Error{Code: CodeNetwork, Message: "无法解析服务器域名，请检查地址与网络"}
	}
	// TLS 握手 / 证书校验失败。
	var recordErr tls.RecordHeaderError
	var unknownAuthority x509.UnknownAuthorityError
	var hostnameErr x509.HostnameError
	var certInvalid x509.CertificateInvalidError
	if errors.As(err, &recordErr) {
		return &Error{Code: CodeNetwork, Message: "对方不是 HTTPS 服务，请检查协议与端口"}
	}
	if errors.As(err, &unknownAuthority) || errors.As(err, &hostnameErr) || errors.As(err, &certInvalid) {
		return &Error{Code: CodeNetwork, Message: "HTTPS 证书校验失败，请检查服务器证书"}
	}
	return &Error{Code: CodeNetwork, Message: "连不上服务器，请检查地址与网络"}
}

const propfindBody = `<?xml version="1.0" encoding="utf-8"?>` +
	`<d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>`

// cancelOnClose 把请求 context 的生命周期绑到响应 body 上：仅当调用方读完并关闭 body
// 时才取消 context。旧实现用 defer cancel()，send 一返回就取消，调用方随后读 body 必然
// 拿到 context canceled（列目录之后中断、被误报为「连不上服务器」）。
type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c *cancelOnClose) Close() error {
	err := c.ReadCloser.Close()
	c.cancel()
	return err
}

func send(cfg Config, method, target string, deps Deps, body []byte, headers map[string]string) (*http.Response, error) {
	client := deps.Client
	if client == nil {
		client = http.DefaultClient
	}
	timeout := time.Duration(cfg.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)

	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		cancel()
		return nil, &Error{Code: CodeInvalidURL, Message: "WebDAV 地址格式不正确"}
	}
	request.Header.Set("Authorization", BuildAuthHeader(cfg.Username, cfg.Password))
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := client.Do(request)
	if err != nil {
		cancel()
		return nil, mapFetchError(err)
	}
	response.Body = &cancelOnClose{ReadCloser: response.Body, cancel: cancel}
	return response, nil
}

// ListBackups 列出远端本应用备份（时间倒序）。
func ListBackups(cfg Config, deps Deps) ([]RemoteFile, error) {
	base, err := NormalizeBaseURL(cfg.URL)
	if err != nil {
		return nil, err
	}
	response, err := send(cfg, "PROPFIND", base, deps, []byte(propfindBody), map[string]string{
		"Content-Type": "application/xml; charset=utf-8",
		"Depth":        "1",
	})
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, MapHTTPError(response.StatusCode)
	}
	content, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, mapFetchError(err)
	}
	return ParsePropfind(string(content)), nil
}

func ensureCollection(cfg Config, base string, deps Deps) error {
	response, err := send(cfg, "MKCOL", base, deps, nil, nil)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	// 目录已存在：MKCOL 按 RFC 4918 返回 405（部分服务器返回 301）。
	if response.StatusCode == 405 || response.StatusCode == 301 {
		return nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return MapHTTPError(response.StatusCode)
	}
	return nil
}

// UploadFile 上传备份：先 MKCOL 建目录（已存在忽略），再 PUT。
func UploadFile(cfg Config, content []byte, fileName string, deps Deps) error {
	base, err := NormalizeBaseURL(cfg.URL)
	if err != nil {
		return err
	}
	if err := ensureCollection(cfg, base, deps); err != nil {
		return err
	}
	response, err := send(cfg, "PUT", JoinURL(base, fileName), deps, content, map[string]string{
		"Content-Type": "application/zip",
	})
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return MapHTTPError(response.StatusCode)
	}
	return nil
}

// DownloadFile 下载文件字节。
func DownloadFile(cfg Config, fileName string, deps Deps) ([]byte, error) {
	base, err := NormalizeBaseURL(cfg.URL)
	if err != nil {
		return nil, err
	}
	response, err := send(cfg, "GET", JoinURL(base, fileName), deps, nil, nil)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, MapHTTPError(response.StatusCode)
	}
	content, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, mapFetchError(err)
	}
	return content, nil
}

// DeleteFile 删除文件。
func DeleteFile(cfg Config, fileName string, deps Deps) error {
	base, err := NormalizeBaseURL(cfg.URL)
	if err != nil {
		return err
	}
	response, err := send(cfg, "DELETE", JoinURL(base, fileName), deps, nil, nil)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return MapHTTPError(response.StatusCode)
	}
	return nil
}
