package webdav

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// propfindFixture 构造一段含 count 个备份条目的 PROPFIND 多状态响应。
func propfindFixture(count int) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">`)
	for i := 0; i < count; i++ {
		fmt.Fprintf(&b, `<d:response><d:href>/reminder/reminder-backup-20260101-%06d.zip</d:href>`+
			`<d:propstat><d:prop><d:getcontentlength>%d</d:getcontentlength>`+
			`<d:getlastmodified>Thu, 01 Jan 2026 00:00:00 GMT</d:getlastmodified>`+
			`<d:getetag>"etag-%d"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`, i, 123+i, i)
	}
	b.WriteString(`</d:multistatus>`)
	return b.String()
}

// TestListBackupsReadsStreamedBody 回归：响应头先到、body 稍后到达时，读取 body 不得因
// 请求 context 被提前取消而失败（真实网络/nginx 下 PROPFIND 响应即为此形态）。
func TestListBackupsReadsStreamedBody(t *testing.T) {
	body := propfindFixture(20)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.WriteHeader(http.StatusMultiStatus)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		// 保证 send 返回时 body 尚未就绪，复现旧实现的 context canceled。
		time.Sleep(150 * time.Millisecond)
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()

	cfg := ConfigWith(server.URL+"/reminder/", "u", "p", 20000)
	files, err := ListBackups(cfg, Deps{Client: server.Client()})
	if err != nil {
		t.Fatalf("ListBackups 读取流式 body 失败：%v", err)
	}
	if len(files) != 20 {
		t.Fatalf("期望 20 个备份，实际 %d", len(files))
	}
}

// TestListBackupsMapsHTTPStatus 校验非 2xx 状态映射为对应错误码。
func TestListBackupsMapsHTTPStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	cfg := ConfigWith(server.URL+"/reminder/", "u", "p", 20000)
	_, err := ListBackups(cfg, Deps{Client: server.Client()})
	var webdavErr *Error
	if !errors.As(err, &webdavErr) || webdavErr.Code != CodeAuth {
		t.Fatalf("期望 AUTH 错误，实际 %v", err)
	}
}

// TestUploadFileMKCOLandPUT 校验建目录被忽略（405）后仍能成功 PUT。
func TestUploadFileMKCOLandPUT(t *testing.T) {
	var putBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "MKCOL":
			w.WriteHeader(http.StatusMethodNotAllowed)
		case "PUT":
			data, _ := io.ReadAll(r.Body)
			putBody = string(data)
			w.WriteHeader(http.StatusCreated)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	defer server.Close()

	cfg := ConfigWith(server.URL+"/reminder/", "u", "p", 20000)
	if err := UploadFile(cfg, []byte("zip-bytes"), "reminder-backup-20260101-000000.zip", Deps{Client: server.Client()}); err != nil {
		t.Fatalf("UploadFile 失败：%v", err)
	}
	if putBody != "zip-bytes" {
		t.Fatalf("PUT body 不符：%q", putBody)
	}
}

// TestMapFetchErrorClassifies 校验底层传输错误被区分为超时 / DNS / 证书 / 连接失败。
func TestMapFetchErrorClassifies(t *testing.T) {
	cases := []struct {
		name    string
		err     error
		code    ErrorCode
		message string
	}{
		{"deadline", context.DeadlineExceeded, CodeTimeout, "连接超时，请检查地址与网络"},
		{"canceled", context.Canceled, CodeNetwork, "请求被中断，请稍后重试"},
		{"dns", &net.DNSError{Err: "no such host", Name: "nope.invalid"}, CodeNetwork, "无法解析服务器域名，请检查地址与网络"},
		{"tls-record", tls.RecordHeaderError{Msg: "first record does not look like a TLS handshake"}, CodeNetwork, "对方不是 HTTPS 服务，请检查协议与端口"},
		{"tls-cert", x509.UnknownAuthorityError{}, CodeNetwork, "HTTPS 证书校验失败，请检查服务器证书"},
		{"other", errors.New("connection refused"), CodeNetwork, "连不上服务器，请检查地址与网络"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mapped := mapFetchError(tc.err)
			if mapped.Code != tc.code || mapped.Message != tc.message {
				t.Fatalf("期望 %s/%s，实际 %s/%s", tc.code, tc.message, mapped.Code, mapped.Message)
			}
		})
	}
}

// TestJoinURL 校验文件名被百分号编码、base 尾斜杠保持。
func TestJoinURL(t *testing.T) {
	got := JoinURL("https://example.com/reminder/", "reminder-backup-20260101-000000.zip")
	want := "https://example.com/reminder/reminder-backup-20260101-000000.zip"
	if got != want {
		t.Fatalf("JoinURL = %q，期望 %q", got, want)
	}
}
