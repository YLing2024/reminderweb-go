package httpapi

import (
	"errors"

	"reminderweb-go/internal/settings"
	"reminderweb-go/internal/sync"
	"reminderweb-go/internal/syncconfig"
	"reminderweb-go/internal/webdav"
	"reminderweb-go/internal/wire"
)

// DisabledStatus 是引擎缺失（理论上不会）时的同步状态。
func DisabledStatus() sync.SyncStatus {
	return sync.SyncStatus{
		Enabled:        false,
		RemoteFiles:    []sync.RemoteFileStatus{},
		LastAction:     sync.ActionNone,
		PendingChanges: false,
	}
}

func (s *Server) handleSyncStatus(ctx *Context) (Response, error) {
	if ctx.Sync == nil {
		return sendJSON(200, DisabledStatus()), nil
	}
	return sendJSON(200, ctx.Sync.Status()), nil
}

func (s *Server) handleSyncNow(ctx *Context) (Response, error) {
	if ctx.Sync == nil {
		return sendJSON(409, map[string]any{"error": "sync_disabled"}), nil
	}
	status, ok := ctx.Sync.RunNow()
	if !ok {
		return sendJSON(409, map[string]any{"error": "sync_in_progress"}), nil
	}
	return sendJSON(200, status), nil
}

func (s *Server) handleSyncConfigGet(ctx *Context) (Response, error) {
	if ctx.Sync != nil {
		return sendJSON(200, ctx.Sync.ConfigView()), nil
	}
	stored := syncconfig.ReadSyncConfig(ctx.DB, ctx.Config)
	url := settings.ReadServerSettings(ctx.DB, ctx.Config).WebdavURL
	return sendJSON(200, syncconfig.SyncConfigViewFor(stored, url)), nil
}

func (s *Server) handleSyncConfigPut(ctx *Context) (Response, error) {
	if ctx.Sync != nil {
		view, err := ctx.Sync.UpdateConfig(ctx.Body)
		if err != nil {
			if resp, ok := syncConfigErrorResponse(err); ok {
				return resp, nil
			}
			return Response{}, err
		}
		return sendJSON(200, view), nil
	}
	patch, err := syncconfig.ParseSyncConfigPatch(ctx.Body)
	if err != nil {
		if resp, ok := syncConfigErrorResponse(err); ok {
			return resp, nil
		}
		return Response{}, err
	}
	stored, err := syncconfig.ApplySyncConfigPatch(ctx.DB, ctx.Config, patch)
	if err != nil {
		return Response{}, err
	}
	url := settings.ReadServerSettings(ctx.DB, ctx.Config).WebdavURL
	return sendJSON(200, syncconfig.SyncConfigViewFor(stored, url)), nil
}

func syncConfigErrorResponse(err error) (Response, bool) {
	var configErr *syncconfig.SyncConfigError
	if errors.As(err, &configErr) {
		return messageError(400, "invalid_config", configErr.Message), true
	}
	return Response{}, false
}

func (s *Server) handleSyncFiles(ctx *Context) (Response, error) {
	if ctx.Sync == nil {
		return sendJSON(200, map[string]any{"files": []any{}}), nil
	}
	files, err := ctx.Sync.ListFiles()
	if err != nil {
		return Response{}, err
	}
	return sendJSON(200, map[string]any{"files": files}), nil
}

func (s *Server) handleSyncUpload(ctx *Context) (Response, error) {
	if ctx.Sync == nil {
		return sendJSON(409, map[string]any{"error": "sync_disabled"}), nil
	}
	result, ran, err := ctx.Sync.RunUpload()
	if !ran {
		return sendJSON(409, map[string]any{"error": "sync_in_progress"}), nil
	}
	if err != nil {
		return Response{}, err
	}
	return sendJSON(200, result), nil
}

func (s *Server) handleSyncRestore(ctx *Context) (Response, error) {
	if ctx.Sync == nil {
		return sendJSON(409, map[string]any{"error": "sync_disabled"}), nil
	}
	name := readName(ctx.Body)
	if name == "" {
		return messageError(400, "invalid_name", "请求缺少备份文件名"), nil
	}
	result, ran, err := ctx.Sync.Restore(name)
	if err != nil {
		return syncErrorResponse(err)
	}
	if !ran {
		return sendJSON(409, map[string]any{"error": "sync_in_progress"}), nil
	}
	return sendJSON(200, result), nil
}

func (s *Server) handleSyncDeleteFile(ctx *Context) (Response, error) {
	if ctx.Sync == nil {
		return sendJSON(409, map[string]any{"error": "sync_disabled"}), nil
	}
	name := ctx.Request.PathValue("name")
	ran, err := ctx.Sync.DeleteRemote(name)
	if err != nil {
		return syncErrorResponse(err)
	}
	if !ran {
		return sendJSON(409, map[string]any{"error": "sync_in_progress"}), nil
	}
	return sendJSON(200, map[string]any{"ok": true}), nil
}

func readName(body any) string {
	record, ok := wire.IsRecord(body)
	if !ok {
		return ""
	}
	value, ok := record["name"].(string)
	if !ok || value == "" {
		return ""
	}
	return value
}

// syncErrorResponse 把手动云端操作错误映射为 HTTP 响应；未预期错误继续上抛交给统一 500。
func syncErrorResponse(err error) (Response, error) {
	var actionErr *sync.ActionError
	if errors.As(err, &actionErr) {
		return messageError(actionErr.Status, actionErr.Code, actionErr.Message), nil
	}
	var webdavErr *webdav.Error
	if errors.As(err, &webdavErr) {
		status := 502
		if webdavErr.Code == webdav.CodeNotFound {
			status = 404
		}
		return messageError(status, "sync_failed", webdavErr.Message), nil
	}
	return Response{}, err
}
