// Package shape 实现安卓备份条目形状 ⇄ 内部条目形状的映射与缺省归一化
// （旧 src/lib/normalize.ts + src/lib/android-shape.ts，前后端共享同一份口径）。
//
// 背景：安卓 kotlinx.serialization 默认 encodeDefaults=false，导出条目只带非默认字段
// （实测 7 个 key）。导入必须逐字段补齐类型安全的缺省值，否则缺失的 endDate 会让前端白屏；
// 同时不得丢弃安卓端未来新增的未知字段。
package shape

import (
	"math"
	"regexp"

	"reminderweb-go/internal/wire"
)

// FallbackDate 缺日期时的安全回落值（固定常量，纯函数不读时钟）。
const FallbackDate = "1970-01-01"

// DefaultNotificationConfig 通知配置默认值，对齐 Kotlin ReminderItem 的默认参数。
func DefaultNotificationConfig() map[string]any {
	return map[string]any{
		"isEnabled":          false,
		"useAppNotification": true,
		"useSystemCalendar":  false,
		"isContinuous":       false,
		"includeStartDay":    true,
		"notificationTimes":  []any{},
	}
}

// DefaultReminderFields 返回提醒的「全字段默认值」表（每次返回新对象，嵌套对象也重建）。
func DefaultReminderFields() map[string]any {
	return map[string]any{
		"id":                         int64(0),
		"title":                      "",
		"date":                       "",
		"endDate":                    nil,
		"type":                       "ANNUAL",
		"isLunar":                    false,
		"tag":                        "",
		"isPinned":                   false,
		"repeatInfo":                 nil,
		"notificationConfig":         DefaultNotificationConfig(),
		"notes":                      "",
		"isCustomized":               false,
		"customHeaderColor":          "",
		"customFont":                 "",
		"cardBackgroundType":         "DEFAULT",
		"cardBackgroundColor":        "",
		"cardBackgroundImagePath":    "",
		"cardBackgroundBlurRadius":   int64(0),
		"cardBackgroundGlassEnabled": false,
		"cardBackgroundGlassFrosted": false,
		"cardBackgroundGlassDensity": 0.5,
		"cardBackgroundTextColor":    "",
		"customFontEffect":           "AUTO",
		"customFontColor":            "",
		"customFontOpacity":          float64(1),
		"customFontBlur":             int64(8),
		"customFontWeight":           int64(700),
		"customFontShadowEnabled":    false,
		"customFontStrokeEnabled":    false,
		"customFontStrokeColor":      "",
	}
}

var (
	reminderTypes = map[string]bool{"ANNUAL": true, "COUNT_UP": true, "BIRTHDAY": true}
	repeatUnits   = map[string]bool{"DAY": true, "WEEK": true, "MONTH": true, "YEAR": true}
	isoDateRe     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

func asString(v any, fallback string) any {
	if s, ok := v.(string); ok {
		return s
	}
	return fallback
}

func asBoolean(v any, fallback bool) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return fallback
}

func asNumber(v any, fallback float64) float64 {
	if f, ok := toFloat(v); ok && !math.IsNaN(f) && !math.IsInf(f, 0) {
		return f
	}
	return fallback
}

// asInteger 用 int64 表示，缺省 / 非整数时回落。JSON 输出仍是整数。
func asInteger(v any, fallback int64) any {
	if i, ok := wire.AsInt64(v); ok {
		return i
	}
	// 非整数但为有限数字时，TS 的 asNumber 语义用于普通数值字段；整数字段一律回落。
	return fallback
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return wireNumber(v)
	}
}

func asNullableDateString(v any) any {
	if s, ok := v.(string); ok && isoDateRe.MatchString(s) {
		return s
	}
	return nil
}

func asEnum(v any, allowed map[string]bool, fallback string) string {
	if s, ok := v.(string); ok && allowed[s] {
		return s
	}
	return fallback
}

func normalizeNotificationTime(raw any) (map[string]any, bool) {
	obj, ok := wire.IsRecord(raw)
	if !ok {
		return nil, false
	}
	return map[string]any{
		"daysBefore": asInteger(obj["daysBefore"], 0),
		"time":       asString(obj["time"], "00:00:00"),
	}, true
}

// NormalizeNotificationConfig 归一化通知配置；缺省或半缺对象都补齐为默认值。
func NormalizeNotificationConfig(raw any) map[string]any {
	source, _ := wire.IsRecord(raw)
	if source == nil {
		source = map[string]any{}
	}
	defaults := DefaultNotificationConfig()
	rawTimes, _ := source["notificationTimes"].([]any)
	times := make([]any, 0, len(rawTimes))
	for _, entry := range rawTimes {
		if normalized, ok := normalizeNotificationTime(entry); ok {
			times = append(times, normalized)
		}
	}
	return map[string]any{
		"isEnabled":          asBoolean(source["isEnabled"], defaults["isEnabled"].(bool)),
		"useAppNotification": asBoolean(source["useAppNotification"], defaults["useAppNotification"].(bool)),
		"useSystemCalendar":  asBoolean(source["useSystemCalendar"], defaults["useSystemCalendar"].(bool)),
		"isContinuous":       asBoolean(source["isContinuous"], defaults["isContinuous"].(bool)),
		"includeStartDay":    asBoolean(source["includeStartDay"], defaults["includeStartDay"].(bool)),
		"notificationTimes":  times,
	}
}

// NormalizeRepeatInfo 归一化重复信息；nil / 缺失保持 nil。
func NormalizeRepeatInfo(raw any) any {
	if raw == nil {
		return nil
	}
	source, ok := wire.IsRecord(raw)
	if !ok {
		source = map[string]any{}
	}
	return map[string]any{
		"interval": asInteger(source["interval"], 1),
		"unit":     asEnum(source["unit"], repeatUnits, "YEAR"),
		"endDate":  asNullableDateString(source["endDate"]),
	}
}

// NormalizeReminder 归一化单条提醒：已知字段缺省回落，未知字段原样保留。
func NormalizeReminder(raw any) map[string]any {
	source, ok := wire.IsRecord(raw)
	if !ok {
		source = map[string]any{}
	}
	out := DefaultReminderFields()
	// 先透传未知字段（安卓液态玻璃参数 + 未来字段），再用已知字段覆盖。
	for key, value := range source {
		if _, known := out[key]; !known {
			out[key] = value
		}
	}
	out["id"] = asInteger(source["id"], 0)
	out["title"] = asString(source["title"], "")
	if s, ok := source["date"].(string); ok && isoDateRe.MatchString(s) {
		out["date"] = s
	} else {
		out["date"] = FallbackDate
	}
	out["endDate"] = asNullableDateString(source["endDate"])
	out["type"] = asEnum(source["type"], reminderTypes, "ANNUAL")
	out["isLunar"] = asBoolean(source["isLunar"], false)
	out["tag"] = asString(source["tag"], "")
	out["isPinned"] = asBoolean(source["isPinned"], false)
	out["repeatInfo"] = NormalizeRepeatInfo(source["repeatInfo"])
	out["notificationConfig"] = NormalizeNotificationConfig(source["notificationConfig"])
	out["notes"] = asString(source["notes"], "")
	out["isCustomized"] = asBoolean(source["isCustomized"], false)
	out["customHeaderColor"] = asString(source["customHeaderColor"], "")
	out["customFont"] = asString(source["customFont"], "")
	out["cardBackgroundType"] = asString(source["cardBackgroundType"], "DEFAULT")
	out["cardBackgroundColor"] = asString(source["cardBackgroundColor"], "")
	out["cardBackgroundImagePath"] = asString(source["cardBackgroundImagePath"], "")
	out["cardBackgroundBlurRadius"] = asNumber(source["cardBackgroundBlurRadius"], 0)
	out["cardBackgroundGlassEnabled"] = asBoolean(source["cardBackgroundGlassEnabled"], false)
	out["cardBackgroundGlassFrosted"] = asBoolean(source["cardBackgroundGlassFrosted"], false)
	out["cardBackgroundGlassDensity"] = asNumber(source["cardBackgroundGlassDensity"], 0.5)
	out["cardBackgroundTextColor"] = asString(source["cardBackgroundTextColor"], "")
	out["customFontEffect"] = asString(source["customFontEffect"], "AUTO")
	out["customFontColor"] = asString(source["customFontColor"], "")
	out["customFontOpacity"] = asNumber(source["customFontOpacity"], 1)
	out["customFontBlur"] = asNumber(source["customFontBlur"], 8)
	out["customFontWeight"] = asNumber(source["customFontWeight"], 700)
	out["customFontShadowEnabled"] = asBoolean(source["customFontShadowEnabled"], false)
	out["customFontStrokeEnabled"] = asBoolean(source["customFontStrokeEnabled"], false)
	out["customFontStrokeColor"] = asString(source["customFontStrokeColor"], "")
	return out
}

// NormalizeTag 归一化标签；缺 color 补上游默认蓝，缺 sortOrder 补 0，保留 updatedAt。
func NormalizeTag(raw any) map[string]any {
	source, ok := wire.IsRecord(raw)
	if !ok {
		source = map[string]any{}
	}
	tag := map[string]any{
		"id":        asInteger(source["id"], 0),
		"name":      asString(source["name"], ""),
		"color":     asString(source["color"], "#2196F3"),
		"sortOrder": asInteger(source["sortOrder"], 0),
	}
	if _, ok := toFloat(source["updatedAt"]); ok {
		tag["updatedAt"], _ = wire.AsInt64(source["updatedAt"])
	}
	return tag
}

// withFieldAliases 兼容个别安卓版本的 `lunar` / `pinned` 拼写（规范字段始终优先）。
func withFieldAliases(raw any) any {
	obj, ok := wire.IsRecord(raw)
	if !ok {
		return raw
	}
	next := make(map[string]any, len(obj)+2)
	for k, v := range obj {
		next[k] = v
	}
	if _, has := next["isLunar"]; !has {
		if v, hasAlias := next["lunar"]; hasAlias {
			next["isLunar"] = v
		}
	}
	if _, has := next["isPinned"]; !has {
		if v, hasAlias := next["pinned"]; hasAlias {
			next["isPinned"] = v
		}
	}
	return next
}

// FromAndroidReminder 把安卓备份条目转换为内部提醒条目；updatedAt 为 nil 时不写入。
func FromAndroidReminder(raw any, updatedAt *int64) map[string]any {
	item := NormalizeReminder(withFieldAliases(raw))
	if updatedAt != nil {
		item["updatedAt"] = *updatedAt
	}
	return item
}

// FromAndroidTag 把安卓备份标签转换为内部标签。
func FromAndroidTag(raw any, updatedAt *int64) map[string]any {
	tag := NormalizeTag(raw)
	if updatedAt != nil {
		tag["updatedAt"] = *updatedAt
	}
	return tag
}

// FromAndroidReminderList 批量转换提醒条目；非数组按空处理。
func FromAndroidReminderList(raw any, updatedAt *int64) []map[string]any {
	array, ok := raw.([]any)
	if !ok {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(array))
	for _, entry := range array {
		out = append(out, FromAndroidReminder(entry, updatedAt))
	}
	return out
}

// FromAndroidTagList 批量转换标签；非数组按空处理。
func FromAndroidTagList(raw any, updatedAt *int64) []map[string]any {
	array, ok := raw.([]any)
	if !ok {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(array))
	for _, entry := range array {
		out = append(out, FromAndroidTag(entry, updatedAt))
	}
	return out
}

// StripSyncMeta 去掉同步元数据 updatedAt，得到可写入与安卓互通备份包的条目。
func StripSyncMeta(item map[string]any) map[string]any {
	out := make(map[string]any, len(item))
	for k, v := range item {
		if k == "updatedAt" {
			continue
		}
		out[k] = v
	}
	return out
}

func wireNumber(v any) (float64, bool) {
	if i, ok := wire.AsInt64(v); ok {
		return float64(i), true
	}
	return 0, false
}
