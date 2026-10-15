package data

import (
	"testing"

	"reminderweb-go/internal/images"
	"reminderweb-go/internal/store"
	"reminderweb-go/internal/store/storetest"
	"reminderweb-go/internal/wire"
)

// newTestDB 打开一个独占的 MySQL 测试库；schema 与生产迁移一致。
func newTestDB(t *testing.T) *store.DB {
	t.Helper()
	return storetest.Open(t)
}

func TestWriteMergedDataBumpsRevisionOnlyOnChange(t *testing.T) {
	db := newTestDB(t)
	outcome := MergeOutcome{
		Reminders: []wire.Item{item(1, 10, "hello")},
		Settings:  wire.SettingsEnvelope{Value: map[string]any{}, UpdatedAt: 0},
		Changed:   true,
	}
	revision, err := WriteMergedData(db, outcome)
	if err != nil {
		t.Fatalf("WriteMergedData 失败：%v", err)
	}
	if revision != 1 {
		t.Fatalf("有变更时 revision 应为 1，得到 %d", revision)
	}

	read, err := ReadServerData(db.SQL())
	if err != nil {
		t.Fatalf("ReadServerData 失败：%v", err)
	}
	if len(read.Reminders) != 1 || read.Reminders[0]["title"] != "hello" {
		t.Fatalf("读回的提醒错误：%+v", read.Reminders)
	}

	// 无变更：revision 不自增。
	revision2, err := WriteMergedData(db, MergeOutcome{
		Reminders: []wire.Item{item(1, 10, "hello")},
		Settings:  read.Settings,
	})
	if err != nil {
		t.Fatalf("WriteMergedData 第二次失败：%v", err)
	}
	if revision2 != 1 {
		t.Fatalf("无变更时 revision 应保持 1，得到 %d", revision2)
	}
}

func TestReadServerDataTombstonesSplitByKind(t *testing.T) {
	db := newTestDB(t)
	outcome := MergeOutcome{
		Reminders:  []wire.Item{item(2, 30, "only")},
		Tags:       []wire.Item{{"id": int64(1), "updatedAt": int64(5), "name": "家人"}},
		Tombstones: []wire.Tombstone{{ID: 9, UpdatedAt: 40, Kind: wire.KindReminder}, {ID: 8, UpdatedAt: 41, Kind: wire.KindTag}},
		Settings:   wire.SettingsEnvelope{Value: map[string]any{}, UpdatedAt: 0},
		Changed:    true,
	}
	if _, err := WriteMergedData(db, outcome); err != nil {
		t.Fatalf("WriteMergedData 失败：%v", err)
	}
	read, err := ReadServerData(db.SQL())
	if err != nil {
		t.Fatalf("ReadServerData 失败：%v", err)
	}
	if len(read.Reminders) != 1 || len(read.Tags) != 1 {
		t.Fatalf("条目数错误：reminders=%d tags=%d", len(read.Reminders), len(read.Tags))
	}
	if len(read.Tombstones) != 2 {
		t.Fatalf("墓碑数 = %d，期望 2", len(read.Tombstones))
	}
	kinds := map[wire.Kind]bool{}
	for _, tomb := range read.Tombstones {
		kinds[tomb.Kind] = true
	}
	if !kinds[wire.KindReminder] || !kinds[wire.KindTag] {
		t.Fatalf("墓碑种类丢失：%+v", read.Tombstones)
	}
}

func TestReplaceServerDataClearsAndRollsBack(t *testing.T) {
	db := newTestDB(t)
	// 先写入一份旧数据。
	if _, err := WriteMergedData(db, MergeOutcome{
		Reminders: []wire.Item{item(1, 10, "old")},
		Settings:  wire.SettingsEnvelope{Value: map[string]any{}, UpdatedAt: 0},
		Changed:   true,
	}); err != nil {
		t.Fatalf("预置数据失败：%v", err)
	}

	// 正常替换：3 条提醒、1 个标签、1 张图片；旧数据被清空。
	revision, err := ReplaceServerData(db, ReplaceDatabaseInput{
		Reminders: []wire.Item{item(7, 100, "new-a"), item(8, 101, "new-b")},
		Tags:      []wire.Item{{"id": int64(3), "updatedAt": int64(102), "name": "t"}},
		Settings:  wire.SettingsEnvelope{Value: map[string]any{"viewMode": "LIST"}, UpdatedAt: 103},
		Images:    []images.StoredImage{{Name: "a.jpg", Bytes: []byte("img")}},
	}, 104)
	if err != nil {
		t.Fatalf("ReplaceServerData 失败：%v", err)
	}
	if revision != 2 {
		t.Fatalf("替换后 revision 应为 2，得到 %d", revision)
	}
	read, err := ReadServerData(db.SQL())
	if err != nil {
		t.Fatalf("ReadServerData 失败：%v", err)
	}
	if len(read.Reminders) != 2 || len(read.Tags) != 1 {
		t.Fatalf("替换后条目数错误：reminders=%d tags=%d", len(read.Reminders), len(read.Tags))
	}
	if read.Settings.Value["viewMode"] != "LIST" {
		t.Fatalf("设置未替换：%+v", read.Settings)
	}
	names, err := images.ReadNames(db.SQL())
	if err != nil || len(names) != 1 || names[0] != "a.jpg" {
		t.Fatalf("图片未写入：%v %v", names, err)
	}

	// 非法替换（重复 id）必须整体回滚，数据保持上一次的成功状态。
	if _, err := ReplaceServerData(db, ReplaceDatabaseInput{
		Reminders: []wire.Item{item(1, 200, "dup"), item(1, 201, "dup")},
		Settings:  wire.SettingsEnvelope{Value: map[string]any{}, UpdatedAt: 200},
	}, 202); err == nil {
		t.Fatal("重复 id 应导致替换失败")
	}
	after, err := ReadServerData(db.SQL())
	if err != nil {
		t.Fatalf("ReadServerData 失败：%v", err)
	}
	if len(after.Reminders) != 2 || after.Reminders[0]["title"] != "new-a" {
		t.Fatalf("回滚后数据被破坏：%+v", after.Reminders)
	}
}
