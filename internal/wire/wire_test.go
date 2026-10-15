package wire

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestDecodeJSONKeepsIntegerPrecision(t *testing.T) {
	// 毫秒时间戳超出 float64 的精确整数范围前也一律按原文保留，避免合并比较出错。
	parsed, err := DecodeJSON([]byte(`{"updatedAt":1700000000000}`))
	if err != nil {
		t.Fatalf("DecodeJSON 失败：%v", err)
	}
	record, ok := IsRecord(parsed)
	if !ok {
		t.Fatalf("期望对象，得到 %T", parsed)
	}
	value, ok := AsInt64(record["updatedAt"])
	if !ok || value != 1700000000000 {
		t.Fatalf("updatedAt = %d, %v；期望 1700000000000", value, ok)
	}
}

func TestAsInt64RejectsNonIntegers(t *testing.T) {
	if _, ok := AsInt64(1.5); ok {
		t.Fatal("非整数值不应被接受")
	}
	if _, ok := AsInt64("12"); ok {
		t.Fatal("字符串不应被接受")
	}
}

func TestParseClientDataCountsRejected(t *testing.T) {
	raw := map[string]any{
		"baseRevision": 3,
		"reminders": []any{
			map[string]any{"id": 1, "title": "ok", "updatedAt": 10},
			map[string]any{"id": 0, "title": "bad id", "updatedAt": 10},
			map[string]any{"id": 3, "title": "missing updatedAt"},
			"not-an-object",
		},
		"tags":     []any{map[string]any{"id": 2, "name": "t", "color": "#fff", "updatedAt": 5}},
		"settings": map[string]any{"value": map[string]any{"viewMode": "CARD"}, "updatedAt": 7},
		"tombstones": []any{
			map[string]any{"id": 9, "updatedAt": 20},
			map[string]any{"id": 10, "updatedAt": 20, "kind": "tag"},
			map[string]any{"id": 11},
		},
	}
	out := ParseClientData(raw)
	if out.BaseRevision != 3 {
		t.Fatalf("BaseRevision = %d，期望 3", out.BaseRevision)
	}
	if len(out.Reminders) != 1 {
		t.Fatalf("合法提醒数 = %d，期望 1", len(out.Reminders))
	}
	if out.Reminders[0]["title"] != "ok" {
		t.Fatalf("解析出的标题 = %v", out.Reminders[0]["title"])
	}
	if out.Rejected != 4 {
		t.Fatalf("rejected = %d，期望 4（坏 id、缺 updatedAt、非对象、缺 updatedAt 的墓碑）", out.Rejected)
	}
	if len(out.Tags) != 1 || out.Settings == nil || out.Settings.UpdatedAt != 7 {
		t.Fatalf("tags=%d settings=%+v", len(out.Tags), out.Settings)
	}
	if len(out.Tombstones) != 2 {
		t.Fatalf("合法墓碑数 = %d，期望 2", len(out.Tombstones))
	}
	if out.Tombstones[0].Kind != KindReminder || out.Tombstones[1].Kind != KindTag {
		t.Fatalf("墓碑 kind 默认 / 显式解析错误：%+v", out.Tombstones)
	}
}

func TestParseTombstoneRejectsBadKind(t *testing.T) {
	if _, ok := ParseTombstone(map[string]any{"id": 1, "updatedAt": 1, "kind": "unknown"}); ok {
		t.Fatal("非法 kind 应被拒绝")
	}
}

func TestParseReplaceDataDecodesImages(t *testing.T) {
	payload := []byte("hello")
	raw := map[string]any{
		"reminders": []any{map[string]any{"id": 1, "title": "x", "updatedAt": 1}},
		"images": []any{
			map[string]any{"name": "a.jpg", "data": base64.StdEncoding.EncodeToString(payload)},
			map[string]any{"name": "../evil", "data": "AAAA"},
			map[string]any{"name": "b.jpg", "data": "not base64 !!"},
		},
	}
	out := ParseReplaceData(raw)
	// 路径穿越名被拒；非法 base64 按 Node 的宽松语义过滤后仍保留条目，故只剩两条。
	if len(out.Images) != 2 {
		t.Fatalf("合法图片数 = %d，期望 2", len(out.Images))
	}
	if out.Images[0].Name != "a.jpg" || string(out.Images[0].Bytes) != "hello" {
		t.Fatalf("图片解码错误：%+v", out.Images[0])
	}
	for _, image := range out.Images {
		if strings.Contains(image.Name, "/") {
			t.Fatalf("非法文件名未被剔除：%s", image.Name)
		}
	}
}

func TestParseSettingsEnvelopeRequiresValueAndUpdatedAt(t *testing.T) {
	if ParseSettingsEnvelope(map[string]any{"updatedAt": 1}) != nil {
		t.Fatal("缺 value 应返回 nil")
	}
	out := ParseSettingsEnvelope(map[string]any{"updatedAt": 2, "value": map[string]any{"k": "v"}})
	if out == nil || out.UpdatedAt != 2 || out.Value["k"] != "v" {
		t.Fatalf("解析设置信封失败：%+v", out)
	}
}

func TestDecodeBase64Lenient(t *testing.T) {
	want := []byte("hi")
	if got := decodeBase64Lenient("aGk="); string(got) != string(want) {
		t.Fatalf("标准 base64 解码错误：%q", got)
	}
	// 忽略非法字符、自动补齐 padding。
	if got := decodeBase64Lenient("aG k"); string(got) != string(want) {
		t.Fatalf("宽松 base64 解码错误：%q", got)
	}
}
