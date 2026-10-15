package shape

import (
	"testing"
)

func TestNormalizeReminderFillsDefaultsAndKeepsUnknown(t *testing.T) {
	// 安卓 encodeDefaults=false 时会缺大量字段；未知字段必须原样保留。
	out := NormalizeReminder(map[string]any{
		"id":                         3,
		"title":                      "生日",
		"date":                       "2026-05-05",
		"type":                       "BIRTHDAY",
		"customGlassBlur":            12, // 安卓端未来/液态玻璃参数
		"notificationTimes":          []any{},
		"cardBackgroundGlassEnabled": true,
	})
	if out["date"] != "2026-05-05" {
		t.Fatalf("date = %v", out["date"])
	}
	if out["type"] != "BIRTHDAY" {
		t.Fatalf("type = %v", out["type"])
	}
	if out["endDate"] != nil {
		t.Fatalf("endDate 缺省应为 nil，得到 %v", out["endDate"])
	}
	if out["customGlassBlur"] != 12 {
		t.Fatalf("未知字段被丢弃：%v", out["customGlassBlur"])
	}
	if out["isLunar"] != false {
		t.Fatalf("isLunar 缺省应为 false")
	}
}

func TestNormalizeReminderFallsBackInvalidDate(t *testing.T) {
	out := NormalizeReminder(map[string]any{"id": 1, "date": "2026/05/05"})
	if out["date"] != FallbackDate {
		t.Fatalf("非法日期应回落到 %s，得到 %v", FallbackDate, out["date"])
	}
}

func TestFromAndroidReminderAliasesAndTimestamp(t *testing.T) {
	ts := int64(1700000000000)
	out := FromAndroidReminder(map[string]any{
		"id":     1,
		"lunar":  true,
		"pinned": true,
		"date":   "2026-01-01",
	}, &ts)
	if out["isLunar"] != true || out["isPinned"] != true {
		t.Fatalf("别名 lunar/pinned 未映射：%+v", out)
	}
	if out["updatedAt"] != ts {
		t.Fatalf("updatedAt 应为 %d，得到 %v", ts, out["updatedAt"])
	}
	// updatedAt 为 nil 时不写入，避免污染备份导出。
	without := FromAndroidReminder(map[string]any{"id": 1, "date": "2026-01-01"}, nil)
	if _, has := without["updatedAt"]; has {
		t.Fatal("updatedAt 为 nil 时不应写入")
	}
}

func TestStripSyncMetaRemovesUpdatedAt(t *testing.T) {
	item := map[string]any{"id": 1, "title": "x", "updatedAt": 123}
	out := StripSyncMeta(item)
	if _, has := out["updatedAt"]; has {
		t.Fatal("updatedAt 未被剥离")
	}
	if out["title"] != "x" {
		t.Fatal("其它字段不应丢失")
	}
	if _, has := item["updatedAt"]; !has {
		t.Fatal("StripSyncMeta 不应修改入参")
	}
}

func TestNormalizeTagDefaultColor(t *testing.T) {
	out := NormalizeTag(map[string]any{"id": 2, "name": "家人"})
	if out["color"] != "#2196F3" {
		t.Fatalf("缺省颜色错误：%v", out["color"])
	}
	if out["sortOrder"] != int64(0) {
		t.Fatalf("缺省 sortOrder 应为 0，得到 %v", out["sortOrder"])
	}
	if _, has := out["updatedAt"]; has {
		t.Fatal("未提供 updatedAt 时不应写入")
	}
}
