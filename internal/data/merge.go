// Package data 实现业务数据层（旧 server/src/data.ts）：读取、条目级合并、写入、整库替换。
//
// 合并规则（纯函数 MergeData，可单测）：
//   - 提醒 / 标签按 id 对齐，两侧同 id 时取 updatedAt 大者；
//   - 相同 updatedAt 时以服务端现状为准（保证幂等）；
//   - 墓碑优先级高于普通条目：updatedAt 相同时墓碑胜出；
//   - 客户端「未提及」的服务端条目原样保留（不做隐式删除）。
package data

import (
	"fmt"
	"sort"

	"reminderweb-go/internal/wire"
)

// ServerData 是服务端当前完整状态。
type ServerData struct {
	Reminders  []wire.Item
	Tags       []wire.Item
	Settings   wire.SettingsEnvelope
	Tombstones []wire.Tombstone
}

// MergeInput 是待合并的客户端输入。
type MergeInput struct {
	Reminders  []wire.Item
	Tags       []wire.Item
	Settings   *wire.SettingsEnvelope
	Tombstones []wire.Tombstone
}

// MergeOutcome 是合并结果。
type MergeOutcome struct {
	Reminders  []wire.Item
	Tags       []wire.Item
	Settings   wire.SettingsEnvelope
	Tombstones []wire.Tombstone
	// Changed 表示本次合并是否改动了服务端状态（决定 revision 是否自增）。
	Changed bool
}

// ChangeCounts 是合并带来的条目变化计数（用于「已合并 N 条」）。
type ChangeCounts struct {
	Updated int
	Added   int
	Removed int
}

// EmptySettings 返回空设置信封。
func EmptySettings() wire.SettingsEnvelope {
	return wire.SettingsEnvelope{Value: map[string]any{}, UpdatedAt: 0}
}

type row struct {
	id        int64
	updatedAt int64
	deleted   bool
	payload   map[string]any
}

func buildMap(items []wire.Item, tombstones []wire.Tombstone) map[int64]*row {
	out := map[int64]*row{}
	for _, item := range items {
		id, _ := wire.AsInt64(item["id"])
		updatedAt, _ := wire.AsInt64(item["updatedAt"])
		out[id] = &row{id: id, updatedAt: updatedAt, deleted: false, payload: wire.ToStorage(item)}
	}
	for _, tomb := range tombstones {
		existing, ok := out[tomb.ID]
		if !ok {
			out[tomb.ID] = &row{id: tomb.ID, updatedAt: tomb.UpdatedAt, deleted: true}
			continue
		}
		if tomb.UpdatedAt >= existing.updatedAt {
			existing.deleted = true
			existing.updatedAt = tomb.UpdatedAt
			existing.payload = nil
		}
	}
	return out
}

func applyItems(target map[int64]*row, items []wire.Item) {
	for _, item := range items {
		id, _ := wire.AsInt64(item["id"])
		updatedAt, _ := wire.AsInt64(item["updatedAt"])
		existing, ok := target[id]
		if !ok || updatedAt > existing.updatedAt {
			target[id] = &row{id: id, updatedAt: updatedAt, deleted: false, payload: wire.ToStorage(item)}
		}
		// 相同或更旧：以服务端现状为准（幂等）。
	}
}

func applyTombstones(target map[int64]*row, tombstones []wire.Tombstone) {
	for _, tomb := range tombstones {
		existing, ok := target[tomb.ID]
		if !ok {
			target[tomb.ID] = &row{id: tomb.ID, updatedAt: tomb.UpdatedAt, deleted: true}
			continue
		}
		if tomb.UpdatedAt > existing.updatedAt || (tomb.UpdatedAt == existing.updatedAt && !existing.deleted) {
			existing.deleted = true
			existing.updatedAt = tomb.UpdatedAt
			existing.payload = nil
		}
	}
}

func snapshot(target map[int64]*row) map[int64]string {
	out := make(map[int64]string, len(target))
	for id, entry := range target {
		flag := 0
		if entry.deleted {
			flag = 1
		}
		out[id] = fmt.Sprintf("%d:%d", entry.updatedAt, flag)
	}
	return out
}

func snapshotsEqual(a, b map[int64]string) bool {
	if len(a) != len(b) {
		return false
	}
	for id, signature := range a {
		if b[id] != signature {
			return false
		}
	}
	return true
}

func collect(target map[int64]*row, kind wire.Kind) ([]wire.Item, []wire.Tombstone) {
	items := make([]wire.Item, 0, len(target))
	tombstones := make([]wire.Tombstone, 0)
	for _, entry := range target {
		if entry.deleted {
			tombstones = append(tombstones, wire.Tombstone{ID: entry.id, UpdatedAt: entry.updatedAt, Kind: kind})
		} else {
			items = append(items, wire.FromStorage(entry.id, entry.updatedAt, entry.payload))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		left, _ := wire.AsInt64(items[i]["id"])
		right, _ := wire.AsInt64(items[j]["id"])
		return left < right
	})
	sort.Slice(tombstones, func(i, j int) bool { return tombstones[i].ID < tombstones[j].ID })
	return items, tombstones
}

// MergeData 执行条目级合并（纯函数）。
func MergeData(server ServerData, client MergeInput) MergeOutcome {
	var reminderTombstones, tagTombstones []wire.Tombstone
	for _, tomb := range server.Tombstones {
		if tomb.Kind == wire.KindTag {
			tagTombstones = append(tagTombstones, tomb)
		} else {
			reminderTombstones = append(reminderTombstones, tomb)
		}
	}

	reminderMap := buildMap(server.Reminders, reminderTombstones)
	tagMap := buildMap(server.Tags, tagTombstones)
	beforeReminders := snapshot(reminderMap)
	beforeTags := snapshot(tagMap)

	applyItems(reminderMap, client.Reminders)
	var clientReminderTombstones, clientTagTombstones []wire.Tombstone
	for _, tomb := range client.Tombstones {
		if tomb.Kind == wire.KindTag {
			clientTagTombstones = append(clientTagTombstones, tomb)
		} else {
			clientReminderTombstones = append(clientReminderTombstones, tomb)
		}
	}
	applyTombstones(reminderMap, clientReminderTombstones)
	applyItems(tagMap, client.Tags)
	applyTombstones(tagMap, clientTagTombstones)

	clientSettingsWins := client.Settings != nil && client.Settings.UpdatedAt > server.Settings.UpdatedAt
	settings := server.Settings
	if clientSettingsWins {
		settings = *client.Settings
	}

	changed := !snapshotsEqual(snapshot(reminderMap), beforeReminders) ||
		!snapshotsEqual(snapshot(tagMap), beforeTags) ||
		clientSettingsWins

	reminders, reminderTombstoneOut := collect(reminderMap, wire.KindReminder)
	tags, tagTombstoneOut := collect(tagMap, wire.KindTag)
	return MergeOutcome{
		Reminders:  reminders,
		Tags:       tags,
		Settings:   settings,
		Tombstones: append(reminderTombstoneOut, tagTombstoneOut...),
		Changed:    changed,
	}
}

type signature struct {
	updatedAt int64
	deleted   bool
}

func signatureMap(items []wire.Item, tombstones []wire.Tombstone) map[int64]signature {
	out := map[int64]signature{}
	for _, item := range items {
		id, _ := wire.AsInt64(item["id"])
		updatedAt, _ := wire.AsInt64(item["updatedAt"])
		out[id] = signature{updatedAt: updatedAt, deleted: false}
	}
	for _, tomb := range tombstones {
		existing, ok := out[tomb.ID]
		if !ok || tomb.UpdatedAt >= existing.updatedAt {
			out[tomb.ID] = signature{updatedAt: tomb.UpdatedAt, deleted: true}
		}
	}
	return out
}

func countKind(before, after map[int64]signature, counts *ChangeCounts) {
	ids := map[int64]bool{}
	for id := range before {
		ids[id] = true
	}
	for id := range after {
		ids[id] = true
	}
	for id := range ids {
		old, hadOld := before[id]
		next, hasNext := after[id]
		if !hasNext {
			if hadOld && !old.deleted {
				counts.Removed++
			}
			continue
		}
		if !hadOld {
			if next.deleted {
				counts.Removed++
			} else {
				counts.Added++
			}
			continue
		}
		if old.deleted != next.deleted {
			if next.deleted {
				counts.Removed++
			} else {
				counts.Added++
			}
			continue
		}
		if old.updatedAt != next.updatedAt {
			counts.Updated++
		}
	}
}

// CountChanges 对比合并前后的服务端状态，统计「更新 / 新增 / 删除」条目数；
// 设置信封发生变化时计入 Updated 一次。纯函数，供自动同步与恢复共用。
func CountChanges(before ServerData, outcome MergeOutcome) ChangeCounts {
	counts := ChangeCounts{}
	reminderBefore := signatureMap(before.Reminders, filterKind(before.Tombstones, wire.KindReminder))
	tagBefore := signatureMap(before.Tags, filterKind(before.Tombstones, wire.KindTag))
	reminderAfter := signatureMap(outcome.Reminders, filterKind(outcome.Tombstones, wire.KindReminder))
	tagAfter := signatureMap(outcome.Tags, filterKind(outcome.Tombstones, wire.KindTag))
	countKind(reminderBefore, reminderAfter, &counts)
	countKind(tagBefore, tagAfter, &counts)
	if outcome.Settings.UpdatedAt != before.Settings.UpdatedAt {
		counts.Updated++
	}
	return counts
}

func filterKind(tombstones []wire.Tombstone, kind wire.Kind) []wire.Tombstone {
	out := make([]wire.Tombstone, 0, len(tombstones))
	for _, tomb := range tombstones {
		if tomb.Kind == kind {
			out = append(out, tomb)
		}
	}
	return out
}
