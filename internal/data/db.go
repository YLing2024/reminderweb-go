package data

import (
	"database/sql"
	"fmt"

	"reminderweb-go/internal/images"
	"reminderweb-go/internal/store"
	"reminderweb-go/internal/wire"
)

// ReadRevision 返回当前 revision。
func ReadRevision(db *store.DB) (int64, error) { return db.Revision() }

type rowRecord struct {
	id        int64
	payload   string
	updatedAt int64
	deleted   int64
}

func readKind(q store.Querier, table string) ([]wire.Item, []wire.Tombstone, error) {
	rows, err := q.Query(fmt.Sprintf("SELECT id, payload, updated_at, deleted FROM %s ORDER BY id ASC", table))
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	items := []wire.Item{}
	tombstones := []wire.Tombstone{}
	kind := wire.KindReminder
	if table == "tags" {
		kind = wire.KindTag
	}
	for rows.Next() {
		var record rowRecord
		if err := rows.Scan(&record.id, &record.payload, &record.updatedAt, &record.deleted); err != nil {
			return nil, nil, err
		}
		var payload map[string]any
		if parsed, err := wire.DecodeJSON([]byte(record.payload)); err == nil {
			payload, _ = wire.IsRecord(parsed)
		}
		if record.deleted == 1 {
			tombstones = append(tombstones, wire.Tombstone{ID: record.id, UpdatedAt: record.updatedAt, Kind: kind})
		} else {
			items = append(items, wire.FromStorage(record.id, record.updatedAt, payload))
		}
	}
	return items, tombstones, rows.Err()
}

// ReadServerData 读取服务端当前完整状态。
func ReadServerData(q store.Querier) (ServerData, error) {
	reminders, reminderTombstones, err := readKind(q, "reminders")
	if err != nil {
		return ServerData{}, err
	}
	tags, tagTombstones, err := readKind(q, "tags")
	if err != nil {
		return ServerData{}, err
	}
	settings := EmptySettings()
	var payload string
	var updatedAt int64
	err = q.QueryRow("SELECT payload, updated_at FROM settings WHERE k = ?", "app").Scan(&payload, &updatedAt)
	if err != nil && err != sql.ErrNoRows {
		return ServerData{}, err
	}
	if err == nil {
		if parsed, parseErr := wire.DecodeJSON([]byte(payload)); parseErr == nil {
			if record, ok := wire.IsRecord(parsed); ok {
				if value, ok := wire.IsRecord(record["value"]); ok {
					settings = wire.SettingsEnvelope{Value: value, UpdatedAt: updatedAt}
				}
			}
		}
	}
	return ServerData{
		Reminders:  reminders,
		Tags:       tags,
		Settings:   settings,
		Tombstones: append(reminderTombstones, tagTombstones...),
	}, nil
}

func encodePayload(v any) string {
	out, err := wire.EncodeJSON(v)
	if err != nil {
		return "null"
	}
	return string(out)
}

func upsertKind(q store.Querier, table string, outcome MergeOutcome, kind wire.Kind) error {
	items := outcome.Reminders
	if kind == wire.KindTag {
		items = outcome.Tags
	}
	statement := fmt.Sprintf(
		`INSERT INTO %s (id, payload, updated_at, deleted) VALUES (?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, deleted = excluded.deleted`,
		table,
	)
	for _, item := range items {
		id, _ := wire.AsInt64(item["id"])
		updatedAt, _ := wire.AsInt64(item["updatedAt"])
		if _, err := q.Exec(statement, id, encodePayload(wire.ToStorage(item)), updatedAt, 0); err != nil {
			return err
		}
	}
	for _, tomb := range filterKind(outcome.Tombstones, kind) {
		payload := map[string]any{"id": tomb.ID, "updatedAt": tomb.UpdatedAt}
		if _, err := q.Exec(statement, tomb.ID, encodePayload(payload), tomb.UpdatedAt, 1); err != nil {
			return err
		}
	}
	return nil
}

// WriteMergedData 把合并结果落库；有改动时 revision 自增一次，返回新的 revision。
// 整个写入在一个事务里完成，任何一步失败都回滚。
func WriteMergedData(db *store.DB, outcome MergeOutcome) (int64, error) {
	tx, err := db.SQL().Begin()
	if err != nil {
		return 0, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	if err := upsertKind(tx, "reminders", outcome, wire.KindReminder); err != nil {
		return 0, err
	}
	if err := upsertKind(tx, "tags", outcome, wire.KindTag); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(
		"INSERT INTO settings (k, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
		"app", encodePayload(outcome.Settings), outcome.Settings.UpdatedAt,
	); err != nil {
		return 0, err
	}
	var revision int64
	if outcome.Changed {
		revision, err = store.BumpRevisionQ(tx)
	} else {
		revision, err = store.Revision(tx)
	}
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	committed = true
	return revision, nil
}

// ReplaceDatabaseInput 是整库替换的写入输入（M11 §2）。
type ReplaceDatabaseInput struct {
	Reminders []wire.Item
	Tags      []wire.Item
	Settings  wire.SettingsEnvelope
	Images    []images.StoredImage
}

// ReplaceServerData 用请求体整体替换服务端全部数据（提醒 / 标签 / 设置 / 图片字节）。
//
// 与按 updatedAt / 墓碑合并的 WriteMergedData 完全分开：先清空四张表，再原样写入，
// 最后 revision 自增一次；整个操作在一个事务里完成，失败回滚，绝不出现半库状态。
func ReplaceServerData(db *store.DB, input ReplaceDatabaseInput, at int64) (int64, error) {
	tx, err := db.SQL().Begin()
	if err != nil {
		return 0, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	for _, table := range []string{"reminders", "tags", "settings", "images"} {
		if _, err := tx.Exec("DELETE FROM " + table); err != nil {
			return 0, err
		}
	}
	insertReminder, err := tx.Prepare("INSERT INTO reminders (id, payload, updated_at, deleted) VALUES (?, ?, ?, 0)")
	if err != nil {
		return 0, err
	}
	defer insertReminder.Close()
	for _, item := range input.Reminders {
		id, _ := wire.AsInt64(item["id"])
		updatedAt, _ := wire.AsInt64(item["updatedAt"])
		if _, err := insertReminder.Exec(id, encodePayload(wire.ToStorage(item)), updatedAt); err != nil {
			return 0, err
		}
	}
	insertTag, err := tx.Prepare("INSERT INTO tags (id, payload, updated_at, deleted) VALUES (?, ?, ?, 0)")
	if err != nil {
		return 0, err
	}
	defer insertTag.Close()
	for _, tag := range input.Tags {
		id, _ := wire.AsInt64(tag["id"])
		updatedAt, _ := wire.AsInt64(tag["updatedAt"])
		if _, err := insertTag.Exec(id, encodePayload(wire.ToStorage(tag)), updatedAt); err != nil {
			return 0, err
		}
	}
	if _, err := tx.Exec(
		"INSERT INTO settings (k, payload, updated_at) VALUES (?, ?, ?)",
		"app", encodePayload(input.Settings), input.Settings.UpdatedAt,
	); err != nil {
		return 0, err
	}
	if err := images.ReplaceAll(tx, input.Images, at); err != nil {
		return 0, err
	}
	revision, err := store.BumpRevisionQ(tx)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	committed = true
	return revision, nil
}
