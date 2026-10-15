package backup

import (
	"fmt"
	"sort"
	"time"

	"reminderweb-go/internal/data"
	"reminderweb-go/internal/shape"
	"reminderweb-go/internal/wire"
)

// BackupFormatError 表示备份包解析 / 解密失败；Message 为可直接展示的中文文案。
type BackupFormatError struct{ Message string }

func (e *BackupFormatError) Error() string { return e.Message }

// ArchiveInput 是打包输入；图片按 `images/<basename>` 写入。
type ArchiveInput struct {
	MetadataJSON string
	Images       map[string][]byte
}

// ArchiveContent 是解包结果。
type ArchiveContent struct {
	MetadataJSON string
	Images       map[string][]byte
}

// EncodeArchive 打包归档；encrypt=true 时整包加密。
func EncodeArchive(input ArchiveInput, encrypt bool) ([]byte, error) {
	entries := []ZipEntry{{Name: MetadataEntry, Data: []byte(input.MetadataJSON)}}
	names := make([]string, 0, len(input.Images))
	for name := range input.Images {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if name == "" {
			continue
		}
		entries = append(entries, ZipEntry{Name: ImagesDir + basename(name), Data: input.Images[name]})
	}
	archive := ZipCreate(entries)
	if !encrypt {
		return archive, nil
	}
	encrypted, err := EncryptArchive(archive)
	if err != nil {
		return nil, &BackupFormatError{Message: "备份打包失败"}
	}
	return encrypted, nil
}

// DecodeArchive 解析归档：优先按明文 zip，否则尝试解密（与前端 / 安卓一致）。
func DecodeArchive(data []byte) (ArchiveContent, error) {
	zipBytes := data
	if !IsZip(data) {
		decrypted := DecryptArchive(data)
		if decrypted == nil {
			return ArchiveContent{}, &BackupFormatError{Message: "无法识别该备份包：既不是有效的 zip，也无法用上游密钥解密。"}
		}
		if !IsZip(decrypted) {
			return ArchiveContent{}, &BackupFormatError{Message: "解密结果不是有效的备份 zip。"}
		}
		zipBytes = decrypted
	}
	entries, err := ZipExtract(zipBytes)
	if err != nil {
		return ArchiveContent{}, &BackupFormatError{Message: "备份包已损坏，无法解压。"}
	}
	metadata, ok := entries[MetadataEntry]
	if !ok {
		return ArchiveContent{}, &BackupFormatError{Message: "备份包缺少 metadata.json。"}
	}
	images := map[string][]byte{}
	for name, bytes := range entries {
		if len(name) > len(ImagesDir) && name[:len(ImagesDir)] == ImagesDir {
			images[basename(name)] = bytes
		}
	}
	return ArchiveContent{MetadataJSON: string(metadata), Images: images}, nil
}

// BackupFileName 生成备份文件名 `reminder-backup-<yyyyMMdd-HHmmss>.zip`（本地时间）。
func BackupFileName(at time.Time) string {
	local := at.Local()
	return fmt.Sprintf("reminder-backup-%04d%02d%02d-%02d%02d%02d.zip",
		local.Year(), int(local.Month()), local.Day(), local.Hour(), local.Minute(), local.Second())
}

// settingKeys 是备份包中参与服务器同步的设置字段（与前端 BackupData 同名）。
var settingKeys = []string{
	"themeOption",
	"pureBlackEnabled",
	"cardColoringEnabled",
	"defaultPage",
	"viewMode",
	"backupReminderEnabled",
	"dynamicColorEnabled",
	"themeColorPalette",
	"customColorSeed",
	"scrollBehavior",
	"homeCategoryEnabled",
}

// ParsedBackup 是解析后的可合并备份内容。
type ParsedBackup struct {
	Reminders []wire.Item
	Tags      []wire.Item
	Settings  *wire.SettingsEnvelope
	// Rejected 是因 id 非法被丢弃的条目数。
	Rejected int
}

// ParseBackupMetadata 解析 metadata.json，转换为可合并的同步条目。
// updatedAt 由调用方传入（批量同值，来自备份文件 mtime），保证合并幂等；绝不用当前时间。
func ParseBackupMetadata(metadataJSON string, updatedAt int64) (ParsedBackup, error) {
	parsed, err := wire.DecodeJSON([]byte(metadataJSON))
	if err != nil {
		return ParsedBackup{}, &BackupFormatError{Message: "metadata.json 不是合法 JSON。"}
	}
	obj, ok := wire.IsRecord(parsed)
	if !ok {
		return ParsedBackup{}, &BackupFormatError{Message: "metadata.json 结构不正确。"}
	}
	rawReminders, ok := obj["reminders"].([]any)
	if !ok {
		return ParsedBackup{}, &BackupFormatError{Message: "metadata.json 缺少 reminders 列表。"}
	}
	reminders := convertItems(shape.FromAndroidReminderList(rawReminders, &updatedAt), updatedAt)
	rawTags, _ := obj["tags"].([]any)
	tags := convertItems(shape.FromAndroidTagList(rawTags, &updatedAt), updatedAt)

	value := map[string]any{}
	for _, key := range settingKeys {
		if entry, present := obj[key]; present && entry != nil {
			value[key] = entry
		}
	}
	var settings *wire.SettingsEnvelope
	if len(value) > 0 {
		settings = &wire.SettingsEnvelope{Value: value, UpdatedAt: updatedAt}
	}
	rejected := len(rawReminders) - len(reminders) + len(rawTags) - len(tags)
	return ParsedBackup{Reminders: reminders, Tags: tags, Settings: settings, Rejected: rejected}, nil
}

func convertItems(converted []map[string]any, updatedAt int64) []wire.Item {
	out := make([]wire.Item, 0, len(converted))
	for _, item := range converted {
		id, ok := wire.AsInt64(item["id"])
		if !ok || id <= 0 {
			continue
		}
		clone := make(wire.Item, len(item)+2)
		for k, v := range item {
			clone[k] = v
		}
		clone["id"] = id
		clone["updatedAt"] = updatedAt
		out = append(out, clone)
	}
	return out
}

func basename(name string) string {
	last := name
	for i := len(name) - 1; i >= 0; i-- {
		if name[i] == '/' || name[i] == '\\' {
			last = name[i+1:]
			break
		}
	}
	return last
}

// BuildBackupMetadata 由服务端当前状态构造 metadata.json 字符串。
//
// M12 §2：**绝不写入** webDavServer / webDavUsername / webDavPassword / webDavPath：
// 这里显式构造白名单字段，凭据字段不在其中。
func BuildBackupMetadata(server data.ServerData) (string, error) {
	settings := server.Settings.Value
	pick := func(key string) any {
		if v, ok := settings[key]; ok {
			return v
		}
		return nil
	}
	reminders := make([]any, 0, len(server.Reminders))
	for _, item := range server.Reminders {
		reminders = append(reminders, shape.StripSyncMeta(item))
	}
	tags := make([]any, 0, len(server.Tags))
	for _, tag := range server.Tags {
		tags = append(tags, shape.StripSyncMeta(tag))
	}
	viewMode := pick("viewMode")
	scrollBehavior := pick("scrollBehavior")
	out := map[string]any{
		"reminders":             reminders,
		"tags":                  tags,
		"themeOption":           pick("themeOption"),
		"pureBlackEnabled":      pick("pureBlackEnabled"),
		"cardColoringEnabled":   pick("cardColoringEnabled"),
		"defaultPage":           pick("defaultPage"),
		"viewMode":              viewMode,
		"backupReminderEnabled": pick("backupReminderEnabled"),
		"dynamicColorEnabled":   pick("dynamicColorEnabled"),
		"themeColorPalette":     pick("themeColorPalette"),
		"customColorSeed":       pick("customColorSeed"),
		"scrollBehavior":        scrollBehavior,
		"homeCategoryEnabled":   pick("homeCategoryEnabled"),
		"cardBackgroundImages":  nil,
	}
	return string(mustJSON(out)), nil
}

func mustJSON(v any) []byte {
	out, err := wire.EncodeJSON(v)
	if err != nil {
		return []byte("{}")
	}
	return out
}
