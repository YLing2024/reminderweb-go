// Package wire 负责同步条目的校验与解析（旧 server/src/serialize.ts）。
//
// 形状约定对齐前端 types/reminder.ts：提醒 / 标签条目在同步层额外携带 `updatedAt`
// （epoch 毫秒）用于条目级合并；其余字段原样透传，未知字段不丢。
//
// JSON 解析统一走 UseNumber，避免大整数（如 updatedAt 毫秒）经 float64 丢精度。
package wire

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"math"

	"reminderweb-go/internal/images"
)

// Kind 条目种类；提醒与标签的 id 空间相互独立。
type Kind string

const (
	// KindReminder 提醒。
	KindReminder Kind = "reminder"
	// KindTag 标签。
	KindTag Kind = "tag"
)

var reminderTypes = map[string]bool{"ANNUAL": true, "COUNT_UP": true, "BIRTHDAY": true}
var repeatUnits = map[string]bool{"DAY": true, "WEEK": true, "MONTH": true, "YEAR": true}

// Item 是一个完整的同步条目（含 id 与 updatedAt，其余字段原样保留）。
type Item map[string]any

// Tombstone 墓碑（删除标记），用 Kind 区分提醒 / 标签。
// JSON 字段名必须与旧实现 / 前端一致（小驼峰），否则前端解析不到墓碑。
type Tombstone struct {
	ID        int64 `json:"id"`
	UpdatedAt int64 `json:"updatedAt"`
	Kind      Kind  `json:"kind"`
}

// SettingsEnvelope 设置信封：整体作为一个可比较更新的条目。
// 同上：`value` / `updatedAt` 是前后端约定的字段名，不得改成 Go 默认的大写。
type SettingsEnvelope struct {
	Value     map[string]any `json:"value"`
	UpdatedAt int64          `json:"updatedAt"`
}

// ClientData 是 `PUT /api/data` 请求体的解析结果。
type ClientData struct {
	BaseRevision int64
	Reminders    []Item
	Tags         []Item
	Settings     *SettingsEnvelope
	Tombstones   []Tombstone
	Rejected     int
}

// ReplaceImage 是整库替换请求体里的图片条目（base64 已解码）。
type ReplaceImage struct {
	Name  string
	Bytes []byte
}

// ReplaceData 是 `PUT /api/data/replace` 的解析结果。
type ReplaceData struct {
	Reminders []Item
	Tags      []Item
	Settings  SettingsEnvelope
	Images    []ReplaceImage
	Rejected  int
}

// DecodeJSON 解析 JSON，数字保留为 json.Number（保精度）。
func DecodeJSON(data []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var out any
	if err := decoder.Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

// EncodeJSON 序列化；json.Number 按原文输出。
func EncodeJSON(v any) ([]byte, error) { return json.Marshal(v) }

// IsRecord 判断是否为非数组的 JSON 对象。
func IsRecord(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

// AsInt64 尝试把 JSON 数字解释为整数；非整数返回 false。
func AsInt64(v any) (int64, bool) {
	switch n := v.(type) {
	case json.Number:
		if i, err := n.Int64(); err == nil {
			return i, true
		}
		f, err := n.Float64()
		if err != nil {
			return 0, false
		}
		return int64FromFloat(f)
	case float64:
		return int64FromFloat(n)
	case int64:
		return n, true
	case int:
		return int64(n), true
	}
	return 0, false
}

func int64FromFloat(f float64) (int64, bool) {
	if math.IsNaN(f) || math.IsInf(f, 0) || f != math.Trunc(f) {
		return 0, false
	}
	if f < math.MinInt64/2 || f > math.MaxInt64/2 {
		return 0, false
	}
	return int64(f), true
}

func isNumber(v any) bool {
	switch v.(type) {
	case json.Number, float64, float32, int, int64:
		return true
	}
	return false
}

func isPositiveInteger(v any) bool {
	i, ok := AsInt64(v)
	return ok && i > 0
}

func isTimestamp(v any) bool {
	i, ok := AsInt64(v)
	return ok && i >= 0
}

func validateReminderFields(raw map[string]any) bool {
	if v, ok := raw["title"]; ok {
		if _, isStr := v.(string); !isStr {
			return false
		}
	}
	if v, ok := raw["date"]; ok {
		if _, isStr := v.(string); !isStr {
			return false
		}
	}
	if v, ok := raw["endDate"]; ok && v != nil {
		if _, isStr := v.(string); !isStr {
			return false
		}
	}
	if v, ok := raw["type"]; ok {
		s, isStr := v.(string)
		if !isStr || !reminderTypes[s] {
			return false
		}
	}
	if v, ok := raw["isLunar"]; ok {
		if _, isBool := v.(bool); !isBool {
			return false
		}
	}
	if v, ok := raw["tag"]; ok {
		if _, isStr := v.(string); !isStr {
			return false
		}
	}
	if v, ok := raw["isPinned"]; ok {
		if _, isBool := v.(bool); !isBool {
			return false
		}
	}
	if v, ok := raw["notes"]; ok {
		if _, isStr := v.(string); !isStr {
			return false
		}
	}
	if v, ok := raw["repeatInfo"]; ok && v != nil {
		if repeat, isRec := IsRecord(v); isRec {
			if _, hasInterval := repeat["interval"]; hasInterval && !isNumber(repeat["interval"]) {
				return false
			}
			if unit, hasUnit := repeat["unit"]; hasUnit {
				s, isStr := unit.(string)
				if !isStr || !repeatUnits[s] {
					return false
				}
			}
		}
	}
	return true
}

func validateTagFields(raw map[string]any) bool {
	if v, ok := raw["name"]; ok {
		if _, isStr := v.(string); !isStr {
			return false
		}
	}
	if v, ok := raw["color"]; ok {
		if _, isStr := v.(string); !isStr {
			return false
		}
	}
	if v, ok := raw["sortOrder"]; ok {
		if !isNumber(v) {
			return false
		}
	}
	return true
}

// ParseItemOptions 控制条目解析：API 路径要求 updatedAt，导入备份包路径不要求。
type ParseItemOptions struct {
	// RequireUpdatedAt 是否强制要求 updatedAt（默认 true）。
	RequireUpdatedAt bool
	// DefaultUpdatedAt updatedAt 缺失且不强制时的补齐值（导入路径传入备份文件 mtime）。
	DefaultUpdatedAt int64
}

// ParseWireItem 解析单个同步条目；无效返回 nil。
func ParseWireItem(raw any, kind Kind, opts ParseItemOptions) Item {
	obj, ok := IsRecord(raw)
	if !ok {
		return nil
	}
	if !isPositiveInteger(obj["id"]) {
		return nil
	}
	id, _ := AsInt64(obj["id"])
	var updatedAt int64
	if isTimestamp(obj["updatedAt"]) {
		updatedAt, _ = AsInt64(obj["updatedAt"])
	} else if !opts.RequireUpdatedAt {
		updatedAt = opts.DefaultUpdatedAt
	} else {
		return nil
	}
	valid := validateReminderFields(obj)
	if kind == KindTag {
		valid = validateTagFields(obj)
	}
	if !valid {
		return nil
	}
	out := make(Item, len(obj)+2)
	for k, v := range obj {
		out[k] = v
	}
	out["id"] = id
	out["updatedAt"] = updatedAt
	return out
}

// ParseTombstone 解析墓碑；无效返回 nil（含 valid=false）。
func ParseTombstone(raw any) (Tombstone, bool) {
	obj, ok := IsRecord(raw)
	if !ok {
		return Tombstone{}, false
	}
	if !isPositiveInteger(obj["id"]) || !isTimestamp(obj["updatedAt"]) {
		return Tombstone{}, false
	}
	id, _ := AsInt64(obj["id"])
	updatedAt, _ := AsInt64(obj["updatedAt"])
	kind := KindReminder
	if v, ok := obj["kind"]; ok && v != nil {
		s, isStr := v.(string)
		if !isStr || (s != string(KindReminder) && s != string(KindTag)) {
			return Tombstone{}, false
		}
		kind = Kind(s)
	}
	return Tombstone{ID: id, UpdatedAt: updatedAt, Kind: kind}, true
}

// ParseSettingsEnvelope 解析设置信封；无效返回 nil。
func ParseSettingsEnvelope(raw any) *SettingsEnvelope {
	obj, ok := IsRecord(raw)
	if !ok {
		return nil
	}
	if !isTimestamp(obj["updatedAt"]) {
		return nil
	}
	value, ok := IsRecord(obj["value"])
	if !ok {
		return nil
	}
	updatedAt, _ := AsInt64(obj["updatedAt"])
	clone := make(map[string]any, len(value))
	for k, v := range value {
		clone[k] = v
	}
	return &SettingsEnvelope{Value: clone, UpdatedAt: updatedAt}
}

func parseItemList(raw any, kind Kind, rejected *int, opts ParseItemOptions) []Item {
	if raw == nil {
		return []Item{}
	}
	array, ok := raw.([]any)
	if !ok {
		*rejected++
		return []Item{}
	}
	out := make([]Item, 0, len(array))
	for _, entry := range array {
		if item := ParseWireItem(entry, kind, opts); item != nil {
			out = append(out, item)
		} else {
			*rejected++
		}
	}
	return out
}

func parseTombstoneList(raw any, rejected *int) []Tombstone {
	if raw == nil {
		return []Tombstone{}
	}
	array, ok := raw.([]any)
	if !ok {
		*rejected++
		return []Tombstone{}
	}
	out := make([]Tombstone, 0, len(array))
	for _, entry := range array {
		if tomb, ok := ParseTombstone(entry); ok {
			out = append(out, tomb)
		} else {
			*rejected++
		}
	}
	return out
}

// ParseClientData 解析 `PUT /api/data` 请求体（数组缺省视为空，坏条目计入 rejected）。
func ParseClientData(raw any) ClientData {
	obj, ok := IsRecord(raw)
	if !ok {
		return ClientData{Reminders: []Item{}, Tags: []Item{}, Tombstones: []Tombstone{}, Rejected: 1}
	}
	rejected := 0
	var baseRevision int64
	if isNumber(obj["baseRevision"]) {
		f, _ := asFloat(obj["baseRevision"])
		if f >= 0 && !math.IsInf(f, 0) && !math.IsNaN(f) {
			baseRevision = int64(math.Floor(f))
		}
	}
	var settings *SettingsEnvelope
	if v, present := obj["settings"]; present && v != nil {
		settings = ParseSettingsEnvelope(v)
		if settings == nil {
			rejected++
		}
	}
	return ClientData{
		BaseRevision: baseRevision,
		Reminders:    parseItemList(obj["reminders"], KindReminder, &rejected, ParseItemOptions{RequireUpdatedAt: true}),
		Tags:         parseItemList(obj["tags"], KindTag, &rejected, ParseItemOptions{RequireUpdatedAt: true}),
		Settings:     settings,
		Tombstones:   parseTombstoneList(obj["tombstones"], &rejected),
		Rejected:     rejected,
	}
}

func parseReplaceImages(raw any, rejected *int) []ReplaceImage {
	if raw == nil {
		return []ReplaceImage{}
	}
	array, ok := raw.([]any)
	if !ok {
		*rejected++
		return []ReplaceImage{}
	}
	out := make([]ReplaceImage, 0, len(array))
	for _, entry := range array {
		obj, isRec := IsRecord(entry)
		if !isRec {
			*rejected++
			continue
		}
		name, nameOK := obj["name"].(string)
		data, dataOK := obj["data"].(string)
		if !nameOK || !dataOK || !images.IsValidImageName(name) {
			*rejected++
			continue
		}
		bytes := decodeBase64Lenient(data)
		if len(bytes) > images.MaxImageBytes {
			*rejected++
			continue
		}
		out = append(out, ReplaceImage{Name: name, Bytes: bytes})
	}
	return out
}

// ParseReplaceData 解析 `PUT /api/data/replace` 请求体（整库覆盖）。
func ParseReplaceData(raw any) ReplaceData {
	obj, ok := IsRecord(raw)
	if !ok {
		return ReplaceData{Reminders: []Item{}, Tags: []Item{}, Settings: SettingsEnvelope{Value: map[string]any{}}, Images: []ReplaceImage{}, Rejected: 1}
	}
	rejected := 0
	settings := SettingsEnvelope{Value: map[string]any{}, UpdatedAt: 0}
	if v, present := obj["settings"]; present && v != nil {
		parsed := ParseSettingsEnvelope(v)
		if parsed == nil {
			rejected++
		} else {
			settings = *parsed
		}
	}
	return ReplaceData{
		Reminders: parseItemList(obj["reminders"], KindReminder, &rejected, ParseItemOptions{RequireUpdatedAt: true}),
		Tags:      parseItemList(obj["tags"], KindTag, &rejected, ParseItemOptions{RequireUpdatedAt: true}),
		Settings:  settings,
		Images:    parseReplaceImages(obj["images"], &rejected),
		Rejected:  rejected,
	}
}

// ToStorage 归一化为持久化用的 JSON 对象（保留全部字段，未知字段不丢）。
func ToStorage(item Item) map[string]any {
	out := make(map[string]any, len(item))
	for k, v := range item {
		out[k] = v
	}
	return out
}

// FromStorage 从数据库行（payload + updated_at）还原同步条目。
func FromStorage(id, updatedAt int64, payload map[string]any) Item {
	out := make(Item, len(payload)+2)
	for k, v := range payload {
		out[k] = v
	}
	out["id"] = id
	out["updatedAt"] = updatedAt
	return out
}

func asFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case json.Number:
		f, err := n.Float64()
		if err != nil {
			return 0, false
		}
		return f, true
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

// decodeBase64Lenient 尽量还原 Node 的 Buffer.from(str,'base64') 宽松行为：
// 过滤到 base64 字母表、补齐 padding，无法解码时返回空切片（不报错）。
func decodeBase64Lenient(s string) []byte {
	filtered := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '+', c == '/', c == '=':
			filtered = append(filtered, c)
		}
	}
	for len(filtered)%4 != 0 {
		filtered = append(filtered, '=')
	}
	out, err := base64.StdEncoding.DecodeString(string(filtered))
	if err != nil {
		return []byte{}
	}
	return out
}
