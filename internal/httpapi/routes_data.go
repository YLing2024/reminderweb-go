package httpapi

import (
	"encoding/base64"

	"reminderweb-go/internal/data"
	"reminderweb-go/internal/images"
	"reminderweb-go/internal/store"
	"reminderweb-go/internal/wire"
)

func auditDetail(values map[string]any) *string {
	encoded, err := wire.EncodeJSON(values)
	if err != nil {
		return nil
	}
	text := string(encoded)
	return &text
}

func (s *Server) handleGetData(ctx *Context) (Response, error) {
	server, err := data.ReadServerData(ctx.DB.SQL())
	if err != nil {
		return Response{}, err
	}
	revision, err := ctx.DB.Revision()
	if err != nil {
		return Response{}, err
	}
	names, err := images.ReadNames(ctx.DB.SQL())
	if err != nil {
		return Response{}, err
	}
	return sendJSON(200, map[string]any{
		"revision":   revision,
		"reminders":  server.Reminders,
		"tags":       server.Tags,
		"settings":   server.Settings,
		"tombstones": server.Tombstones,
		"imageNames": names,
	}), nil
}

func (s *Server) handleGetFullData(ctx *Context) (Response, error) {
	server, err := data.ReadServerData(ctx.DB.SQL())
	if err != nil {
		return Response{}, err
	}
	revision, err := ctx.DB.Revision()
	if err != nil {
		return Response{}, err
	}
	names, err := images.ReadNames(ctx.DB.SQL())
	if err != nil {
		return Response{}, err
	}
	stored, err := images.ReadAll(ctx.DB.SQL())
	if err != nil {
		return Response{}, err
	}
	list := make([]map[string]any, 0, len(stored))
	for _, image := range stored {
		list = append(list, map[string]any{
			"name": image.Name,
			"data": base64.StdEncoding.EncodeToString(image.Bytes),
		})
	}
	return sendJSON(200, map[string]any{
		"revision":   revision,
		"reminders":  server.Reminders,
		"tags":       server.Tags,
		"settings":   server.Settings,
		"tombstones": server.Tombstones,
		"imageNames": names,
		"images":     list,
	}), nil
}

func (s *Server) handlePutData(ctx *Context) (Response, error) {
	serverRevisionBefore, err := ctx.DB.Revision()
	if err != nil {
		return Response{}, err
	}
	client := wire.ParseClientData(ctx.Body)
	server, err := data.ReadServerData(ctx.DB.SQL())
	if err != nil {
		return Response{}, err
	}
	outcome := data.MergeData(server, data.MergeInput{
		Reminders:  client.Reminders,
		Tags:       client.Tags,
		Settings:   client.Settings,
		Tombstones: client.Tombstones,
	})
	revision, err := data.WriteMergedData(ctx.DB, outcome)
	if err != nil {
		return Response{}, err
	}
	if outcome.Changed && ctx.Sync != nil {
		ctx.Sync.MarkLocalChange()
	}
	actor := "unknown"
	if ctx.Identity != nil {
		actor = ctx.Identity.Username
	}
	_ = ctx.DB.Audit(ctx.Now, actor, "put_data", auditDetail(map[string]any{
		"baseRevision":         client.BaseRevision,
		"serverRevisionBefore": serverRevisionBefore,
		"revision":             revision,
		"rejected":             client.Rejected,
	}))
	names, err := images.ReadNames(ctx.DB.SQL())
	if err != nil {
		return Response{}, err
	}
	return sendJSON(200, map[string]any{
		"revision":             revision,
		"serverRevisionBefore": serverRevisionBefore,
		"baseRevision":         client.BaseRevision,
		"rejected":             client.Rejected,
		"reminders":            outcome.Reminders,
		"tags":                 outcome.Tags,
		"settings":             outcome.Settings,
		"tombstones":           outcome.Tombstones,
		"imageNames":           names,
	}), nil
}

func (s *Server) handlePutReplace(ctx *Context) (Response, error) {
	serverRevisionBefore, err := ctx.DB.Revision()
	if err != nil {
		return Response{}, err
	}
	record, ok := wire.IsRecord(ctx.Body)
	if !ok {
		return messageError(400, "invalid_request", "替换请求体不是对象"), nil
	}
	if _, ok := record["reminders"].([]any); !ok {
		return messageError(400, "invalid_request", "替换请求体缺少 reminders 列表"), nil
	}
	parsed := wire.ParseReplaceData(ctx.Body)
	stored := make([]images.StoredImage, 0, len(parsed.Images))
	for _, image := range parsed.Images {
		stored = append(stored, images.StoredImage{Name: image.Name, Bytes: image.Bytes})
	}
	revision, err := data.ReplaceServerData(ctx.DB, data.ReplaceDatabaseInput{
		Reminders: parsed.Reminders,
		Tags:      parsed.Tags,
		Settings:  parsed.Settings,
		Images:    stored,
	}, ctx.Now)
	if err != nil {
		var httpErr *HttpError
		if asHTTPError(err, &httpErr) {
			return Response{}, httpErr
		}
		return messageError(500, "replace_failed", "整库替换失败，数据未改动"), nil
	}
	if ctx.Sync != nil {
		ctx.Sync.MarkLocalChange()
	}
	actor := "unknown"
	if ctx.Identity != nil {
		actor = ctx.Identity.Username
	}
	_ = ctx.DB.Audit(ctx.Now, actor, "replace_data", auditDetail(map[string]any{
		"serverRevisionBefore": serverRevisionBefore,
		"revision":             revision,
		"reminders":            len(parsed.Reminders),
		"tags":                 len(parsed.Tags),
		"images":               len(parsed.Images),
		"rejected":             parsed.Rejected,
	}))
	server, err := data.ReadServerData(ctx.DB.SQL())
	if err != nil {
		return Response{}, err
	}
	names, err := images.ReadNames(ctx.DB.SQL())
	if err != nil {
		return Response{}, err
	}
	return sendJSON(200, map[string]any{
		"revision":             revision,
		"serverRevisionBefore": serverRevisionBefore,
		"rejected":             parsed.Rejected,
		"counts": map[string]any{
			"reminders": len(server.Reminders),
			"tags":      len(server.Tags),
			"images":    len(names),
		},
		"reminders":  server.Reminders,
		"tags":       server.Tags,
		"settings":   server.Settings,
		"tombstones": server.Tombstones,
		"imageNames": names,
	}), nil
}

func (s *Server) handlePutImage(ctx *Context) (Response, error) {
	name := ctx.Request.PathValue("name")
	raw := ctx.RawBody
	if !images.IsValidImageName(name) {
		return messageError(400, "invalid_name", "图片文件名不合法"), nil
	}
	if len(raw) == 0 {
		return messageError(400, "empty_image", "图片内容为空"), nil
	}
	if len(raw) > images.MaxImageBytes {
		return messageError(413, "payload_too_large", "图片过大"), nil
	}
	if err := withTransaction(ctx.DB, func(q store.Querier) error {
		return images.Upsert(q, name, raw, ctx.Now)
	}); err != nil {
		return Response{}, err
	}
	if ctx.Sync != nil {
		ctx.Sync.MarkLocalChange()
	}
	return sendJSON(200, map[string]any{"ok": true, "name": name}), nil
}

func (s *Server) handleDeleteImage(ctx *Context) (Response, error) {
	name := ctx.Request.PathValue("name")
	if !images.IsValidImageName(name) {
		return messageError(400, "invalid_name", "图片文件名不合法"), nil
	}
	if err := withTransaction(ctx.DB, func(q store.Querier) error {
		_, err := images.Delete(q, name)
		return err
	}); err != nil {
		return Response{}, err
	}
	return sendJSON(200, map[string]any{"ok": true}), nil
}

func (s *Server) handleGetImage(ctx *Context) (Response, error) {
	name := ctx.Request.PathValue("name")
	if !images.IsValidImageName(name) {
		return messageError(400, "invalid_name", "图片文件名不合法"), nil
	}
	content, ok, err := images.Read(ctx.DB.SQL(), name)
	if err != nil {
		return Response{}, err
	}
	if !ok {
		return sendJSON(404, map[string]any{"error": "not_found"}), nil
	}
	return Response{
		Status:  200,
		RawBody: content,
		Headers: map[string]string{"Content-Type": "application/octet-stream"},
	}, nil
}
