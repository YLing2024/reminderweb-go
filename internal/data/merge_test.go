package data

import (
	"testing"

	"reminderweb-go/internal/wire"
)

func item(id, updatedAt int64, title string) wire.Item {
	return wire.Item{"id": id, "updatedAt": updatedAt, "title": title}
}

func TestMergeDataServerWinsOnOlderOrEqualClient(t *testing.T) {
	server := ServerData{
		Reminders: []wire.Item{item(1, 10, "srv")},
		Settings:  EmptySettings(),
	}
	out := MergeData(server, MergeInput{
		Reminders: []wire.Item{item(1, 10, "client")},
	})
	if out.Changed {
		t.Fatal("updatedAt 相同时不应产生变更（幂等）")
	}
	if out.Reminders[0]["title"] != "srv" {
		t.Fatalf("相同 updatedAt 应以服务端为准，得到 %v", out.Reminders[0]["title"])
	}
}

func TestMergeDataClientWinsWhenNewer(t *testing.T) {
	server := ServerData{Reminders: []wire.Item{item(1, 10, "srv")}, Settings: EmptySettings()}
	out := MergeData(server, MergeInput{Reminders: []wire.Item{item(1, 20, "client")}})
	if !out.Changed {
		t.Fatal("更新的条目应产生变更")
	}
	if got := out.Reminders[0]["title"]; got != "client" {
		t.Fatalf("title = %v，期望 client", got)
	}
}

func TestMergeDataTombstoneBeatsItemAtSameTimestamp(t *testing.T) {
	server := ServerData{
		Reminders:  []wire.Item{item(2, 40, "srv")},
		Tombstones: []wire.Tombstone{{ID: 2, UpdatedAt: 40, Kind: wire.KindReminder}},
		Settings:   EmptySettings(),
	}
	// 服务端墓碑 updatedAt 与条目相同：buildMap 中墓碑 >= 条目即胜出。
	out := MergeData(server, MergeInput{})
	if len(out.Reminders) != 0 || len(out.Tombstones) != 1 {
		t.Fatalf("墓碑应胜出：reminders=%d tombstones=%d", len(out.Reminders), len(out.Tombstones))
	}

	// 客户端在同一时刻删除在线条目：applyTombstones 在同 updatedAt 下也令其删除。
	server2 := ServerData{Reminders: []wire.Item{item(3, 50, "srv")}, Settings: EmptySettings()}
	out2 := MergeData(server2, MergeInput{Tombstones: []wire.Tombstone{{ID: 3, UpdatedAt: 50, Kind: wire.KindReminder}}})
	if !out2.Changed || len(out2.Reminders) != 0 || len(out2.Tombstones) != 1 {
		t.Fatalf("客户端删除应生效：changed=%v reminders=%d", out2.Changed, len(out2.Reminders))
	}
}

func TestMergeDataClientDeleteNewerWins(t *testing.T) {
	server := ServerData{Reminders: []wire.Item{item(1, 10, "srv")}, Settings: EmptySettings()}
	out := MergeData(server, MergeInput{Tombstones: []wire.Tombstone{{ID: 1, UpdatedAt: 20, Kind: wire.KindReminder}}})
	if !out.Changed {
		t.Fatal("删除应产生变更")
	}
	if len(out.Reminders) != 0 || len(out.Tombstones) != 1 || out.Tombstones[0].Kind != wire.KindReminder {
		t.Fatalf("删除结果错误：%+v / %+v", out.Reminders, out.Tombstones)
	}
}

func TestMergeDataUnknownServerItemsPreserved(t *testing.T) {
	server := ServerData{
		Reminders: []wire.Item{item(1, 10, "keep"), item(2, 10, "also-keep")},
		Settings:  EmptySettings(),
	}
	out := MergeData(server, MergeInput{Reminders: []wire.Item{item(3, 99, "new")}})
	if len(out.Reminders) != 3 {
		t.Fatalf("客户端「未提及」的服务端条目必须保留，得到 %d 条", len(out.Reminders))
	}
}

func TestMergeDataSettingsByUpdatedAt(t *testing.T) {
	server := ServerData{Settings: wire.SettingsEnvelope{Value: map[string]any{"viewMode": "CARD"}, UpdatedAt: 10}}
	newer := wire.SettingsEnvelope{Value: map[string]any{"viewMode": "LIST"}, UpdatedAt: 20}
	out := MergeData(server, MergeInput{Settings: &newer})
	if !out.Changed || out.Settings.Value["viewMode"] != "LIST" {
		t.Fatalf("更新的设置应胜出：%+v", out.Settings)
	}
	older := wire.SettingsEnvelope{Value: map[string]any{"viewMode": "X"}, UpdatedAt: 5}
	out2 := MergeData(server, MergeInput{Settings: &older})
	if out2.Changed || out2.Settings.Value["viewMode"] != "CARD" {
		t.Fatalf("更旧的设置不应覆盖：%+v", out2.Settings)
	}
}

func TestCountChanges(t *testing.T) {
	before := ServerData{
		Reminders: []wire.Item{item(1, 10, "a"), item(2, 10, "b")},
		Settings:  wire.SettingsEnvelope{Value: map[string]any{}, UpdatedAt: 1},
	}
	// id1 更新、id3 新增、id2 被墓碑删除；设置信封也更新。
	outcome := MergeOutcome{
		Reminders:  []wire.Item{item(1, 20, "a-updated"), item(3, 30, "c")},
		Tombstones: []wire.Tombstone{{ID: 2, UpdatedAt: 25, Kind: wire.KindReminder}},
		Settings:   wire.SettingsEnvelope{Value: map[string]any{}, UpdatedAt: 2},
	}
	counts := CountChanges(before, outcome)
	if counts.Updated != 2 { // id1 更新 + 设置变更一次
		t.Fatalf("Updated = %d，期望 2", counts.Updated)
	}
	if counts.Added != 1 {
		t.Fatalf("Added = %d，期望 1", counts.Added)
	}
	if counts.Removed != 1 {
		t.Fatalf("Removed = %d，期望 1", counts.Removed)
	}
}
