package httpapi

import (
	"reminderweb-go/internal/config"
)

// 服务标识与版本（与旧实现一致）。
const (
	// ServerName 是服务名。
	ServerName = "reminderweb"
	// ServerVersion 是服务版本。
	ServerVersion = "0.1.0"
)

func (s *Server) handleHealth(ctx *Context) (Response, error) {
	revision, err := ctx.DB.Revision()
	if err != nil {
		return Response{}, err
	}
	return sendJSON(200, map[string]any{
		"ok":       true,
		"revision": revision,
		"authMode": string(ctx.Config.AuthMode),
		// builtin 且仍是默认 / 弱口令时为 true，设置页据此显示提醒条（不含口令本身）。
		"authWarning": config.IsWeakAuthPassword(ctx.Config),
	}), nil
}

func (s *Server) handleVersion(ctx *Context) (Response, error) {
	schemaVersion, err := ctx.DB.SchemaVersion()
	if err != nil {
		return Response{}, err
	}
	return sendJSON(200, map[string]any{
		"server":        ServerName,
		"version":       ServerVersion,
		"schemaVersion": schemaVersion,
	}), nil
}
