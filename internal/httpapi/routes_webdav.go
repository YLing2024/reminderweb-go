package httpapi

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"

	"reminderweb-go/internal/settings"
	"reminderweb-go/internal/ssrf"
	"reminderweb-go/internal/webdav"
)

// relayMethods 是允许转发的动词。
var relayMethods = map[string]bool{
	"PROPFIND": true,
	"PUT":      true,
	"GET":      true,
	"HEAD":     true,
	"DELETE":   true,
	"MKCOL":    true,
}

var (
	relayClientOnce sync.Once
	relayClient     *http.Client
)

// relayHTTPClient 返回不自动跟随重定向的客户端，避免借 3xx 绕过 SSRF 校验转发到内网。
func relayHTTPClient() *http.Client {
	relayClientOnce.Do(func() {
		relayClient = &http.Client{
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		}
	})
	return relayClient
}

func (s *Server) handleWebdavConfigGet(ctx *Context) (Response, error) {
	value := settings.ReadServerSettings(ctx.DB, ctx.Config)
	return sendJSON(200, settings.ToView(value)), nil
}

func (s *Server) handleWebdavConfigPut(ctx *Context) (Response, error) {
	patch, err := settings.ParseWebdavConfigPatch(ctx.Body)
	if err != nil {
		if resp, ok := settingErrorResponse(err); ok {
			return resp, nil
		}
		return Response{}, err
	}
	result, err := settings.ApplyWebdavConfigPatch(ctx.DB, ctx.Config, patch)
	if err != nil {
		if resp, ok := settingErrorResponse(err); ok {
			return resp, nil
		}
		return Response{}, err
	}
	// 改完立即生效：同步引擎重读设置并重排定时器，无需重启。
	if ctx.Sync != nil {
		ctx.Sync.ReloadSettings()
	}
	actor := "unknown"
	if ctx.Identity != nil {
		actor = ctx.Identity.Username
	}
	_ = ctx.DB.Audit(ctx.Now, actor, "webdav_config_update", auditDetail(map[string]any{
		"changed":         result.Changed,
		"passwordChanged": result.PasswordChanged,
	}))
	return sendJSON(200, settings.ToView(result.Settings)), nil
}

func settingErrorResponse(err error) (Response, bool) {
	var settingErr *settings.ServerSettingError
	if errors.As(err, &settingErr) {
		return messageError(400, "invalid_config", settingErr.Message), true
	}
	return Response{}, false
}

func (s *Server) handleRelayMethodNotAllowed(_ *Context) (Response, error) {
	return messageError(405, "method_not_allowed", "不支持的转发动词"), nil
}

func (s *Server) handleRelay(ctx *Context) (Response, error) {
	if !relayMethods[ctx.Method] {
		return messageError(405, "method_not_allowed", "不支持的转发动词"), nil
	}
	target := strings.TrimSpace(ctx.Headers.Get("X-Dav-Url"))
	if target == "" {
		return messageError(400, "missing_target", "缺少目标地址"), nil
	}
	allowPrivate := settings.ReadServerSettings(ctx.DB, ctx.Config).RelayAllowPrivate
	check := ssrf.CheckRelayTarget(target, allowPrivate)
	if !check.OK {
		hint := ""
		if !allowPrivate {
			hint = "若你的 WebDAV 装在局域网（NAS、路由器等），请在设置页打开「允许转发到内网地址」。"
		}
		message := check.Reason
		if hint != "" {
			message = message + "。" + hint
		}
		return messageError(403, "target_not_allowed", message), nil
	}

	request, err := http.NewRequest(ctx.Method, target, relayBody(ctx))
	if err != nil {
		return messageError(502, "relay_failed", "转发失败：无法连接目标 WebDAV"), nil
	}
	request.Header.Set("Authorization", webdav.BuildAuthHeader(ctx.Headers.Get("X-Dav-User"), ctx.Headers.Get("X-Dav-Password")))
	if depth := ctx.Headers.Get("Depth"); depth != "" {
		request.Header.Set("Depth", depth)
	}
	if contentType := ctx.Headers.Get("Content-Type"); contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if ifMatch := ctx.Headers.Get("If-Match"); ifMatch != "" {
		request.Header.Set("If-Match", ifMatch)
	}

	response, err := relayHTTPClient().Do(request)
	if err != nil {
		return messageError(502, "relay_failed", "转发失败：无法连接目标 WebDAV"), nil
	}
	defer response.Body.Close()
	content, err := io.ReadAll(response.Body)
	if err != nil {
		return messageError(502, "relay_failed", "转发失败：无法连接目标 WebDAV"), nil
	}
	headers := map[string]string{"Cache-Control": "no-store"}
	for _, name := range []string{"DAV", "ETag", "Content-Length", "Content-Type"} {
		if value := response.Header.Get(name); value != "" {
			headers[name] = value
		}
	}
	return Response{Status: response.StatusCode, RawBody: content, Headers: headers}, nil
}

// relayBody 仅在非 GET / HEAD 且确有请求体时返回可读流。
func relayBody(ctx *Context) io.Reader {
	if ctx.Method == "GET" || ctx.Method == "HEAD" || len(ctx.RawBody) == 0 {
		return nil
	}
	return bytes.NewReader(ctx.RawBody)
}
