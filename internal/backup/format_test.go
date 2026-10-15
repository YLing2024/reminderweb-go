package backup

import (
	"strings"
	"testing"
	"time"

	"reminderweb-go/internal/data"
	"reminderweb-go/internal/wire"
)

func TestArchiveRoundTripPlainAndEncrypted(t *testing.T) {
	input := ArchiveInput{
		MetadataJSON: `{"reminders":[]}`,
		Images:       map[string][]byte{"images/a.jpg": []byte("hello"), "b.png": []byte("png")},
	}
	for _, encrypt := range []bool{false, true} {
		archive, err := EncodeArchive(input, encrypt)
		if err != nil {
			t.Fatalf("encrypt=%v EncodeArchive 失败：%v", encrypt, err)
		}
		if encrypt && IsZip(archive) {
			t.Fatalf("加密包不应被识别为明文 zip")
		}
		content, err := DecodeArchive(archive)
		if err != nil {
			t.Fatalf("encrypt=%v DecodeArchive 失败：%v", encrypt, err)
		}
		if content.MetadataJSON != input.MetadataJSON {
			t.Fatalf("metadata 不一致：%q", content.MetadataJSON)
		}
		// 图片既接受带 images/ 前缀的键，也接受纯 basename，解包后统一为 basename。
		if string(content.Images["a.jpg"]) != "hello" || string(content.Images["b.png"]) != "png" {
			t.Fatalf("图片解包错误：%+v", content.Images)
		}
	}
}

func TestDecodeArchiveRejectsGarbage(t *testing.T) {
	if _, err := DecodeArchive([]byte("not a zip at all")); err == nil {
		t.Fatal("无法识别的数据应报错")
	}
}

func TestBuildBackupMetadataNeverLeaksWebdavCredentials(t *testing.T) {
	server := data.ServerData{
		Reminders: []wire.Item{{"id": int64(1), "title": "x", "updatedAt": int64(123)}},
		Settings: wire.SettingsEnvelope{
			Value: map[string]any{
				"viewMode":       "CARD",
				"webDavServer":   "https://dav.example.com/dav/",
				"webDavUsername": "user",
				"webDavPassword": "example-secret",
				"webDavPath":     "/dav/",
				"themeOption":    "DARK",
			},
			UpdatedAt: 123,
		},
	}
	out, err := BuildBackupMetadata(server)
	if err != nil {
		t.Fatalf("BuildBackupMetadata 失败：%v", err)
	}
	for _, forbidden := range []string{"webDavServer", "webDavUsername", "webDavPassword", "webDavPath", "example-secret"} {
		if strings.Contains(out, forbidden) {
			t.Fatalf("备份元数据泄漏了 %q：%s", forbidden, out)
		}
	}
	if strings.Contains(out, "updatedAt") {
		t.Fatalf("备份条目不应带同步元数据 updatedAt：%s", out)
	}
	if !strings.Contains(out, `"viewMode":"CARD"`) {
		t.Fatalf("白名单设置字段丢失：%s", out)
	}
}

func TestParseBackupMetadataUsesSuppliedTimestamp(t *testing.T) {
	metadata := `{
	  "reminders": [
	    {"id": 1, "title": "生日", "date": "2026-05-05", "type": "BIRTHDAY", "lunar": true},
	    {"id": 0, "title": "坏 id", "date": "2026-05-05"}
	  ],
	  "tags": [{"id": 2, "name": "家人"}],
	  "viewMode": "LIST"
	}`
	ts := int64(1700000000000)
	parsed, err := ParseBackupMetadata(metadata, ts)
	if err != nil {
		t.Fatalf("ParseBackupMetadata 失败：%v", err)
	}
	if len(parsed.Reminders) != 1 {
		t.Fatalf("合法提醒数 = %d，期望 1", len(parsed.Reminders))
	}
	if parsed.Reminders[0]["updatedAt"] != ts {
		t.Fatalf("updatedAt 应使用传入的 mtime，得到 %v", parsed.Reminders[0]["updatedAt"])
	}
	if parsed.Reminders[0]["isLunar"] != true {
		t.Fatalf("lunar 别名未归一化：%+v", parsed.Reminders[0])
	}
	if len(parsed.Tags) != 1 || parsed.Settings == nil || parsed.Settings.Value["viewMode"] != "LIST" {
		t.Fatalf("标签 / 设置解析错误：%+v / %+v", parsed.Tags, parsed.Settings)
	}
	if parsed.Rejected != 1 {
		t.Fatalf("rejected = %d，期望 1", parsed.Rejected)
	}
}

func TestBackupFileNameFormat(t *testing.T) {
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.Local)
	if got := BackupFileName(at); got != "reminder-backup-20260102-030405.zip" {
		t.Fatalf("文件名 = %q", got)
	}
}
