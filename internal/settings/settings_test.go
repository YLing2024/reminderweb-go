package settings

import (
	"testing"

	"reminderweb-go/internal/config"
	"reminderweb-go/internal/store"
)

func testConfig(t *testing.T, env map[string]string) *config.Config {
	t.Helper()
	cfg, err := config.Load(func(key string) string { return env[key] })
	if err != nil {
		t.Fatalf("加载测试配置失败：%v", err)
	}
	return cfg
}

func openTestDB(t *testing.T) *store.DB {
	t.Helper()
	db, err := store.OpenPath(":memory:")
	if err != nil {
		t.Fatalf("打开内存库失败：%v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestToViewNeverExposesPassword(t *testing.T) {
	view := ToView(ServerSettings{WebdavPassword: "example-secret", WebdavURL: "https://dav.example.com/dav/"})
	if view.WebdavPasswordSet != true {
		t.Fatal("已设置口令时 webdavPasswordSet 应为 true")
	}
	// 视图结构体里根本没有口令字段，这里再确认一次未泄漏。
	if view.WebdavURL != "https://dav.example.com/dav/" {
		t.Fatalf("URL 视图错误：%q", view.WebdavURL)
	}
}

func TestReadServerSettingsFallsBackToEnvThenPersists(t *testing.T) {
	db := openTestDB(t)
	cfg := testConfig(t, map[string]string{
		"WEBDAV_URL":      "https://dav.example.com/dav/",
		"WEBDAV_USERNAME": "envuser",
		"WEBDAV_ENABLED":  "0",
	})
	first := ReadServerSettings(db, cfg)
	if first.WebdavURL != "https://dav.example.com/dav/" || first.WebdavUsername != "envuser" {
		t.Fatalf("首次应取环境变量默认值：%+v", first)
	}
	// 落库后再改环境变量也不影响（库值优先）。
	cfg2 := testConfig(t, map[string]string{"WEBDAV_URL": "https://other.example.com/"})
	second := ReadServerSettings(db, cfg2)
	if second.WebdavURL != "https://dav.example.com/dav/" {
		t.Fatalf("库值应优先于环境变量：%+v", second)
	}
}

func TestParseWebdavConfigPatchValidation(t *testing.T) {
	bad := []any{
		map[string]any{}, // 空补丁
		map[string]any{"webdavIntervalMinutes": 0},    // 越界
		map[string]any{"webdavIntervalMinutes": 1441}, // 越界
		map[string]any{"webdavKeep": 1001},            // 越界
		map[string]any{"relayAllowPrivate": "yes"},    // 类型错
	}
	for _, raw := range bad {
		if _, err := ParseWebdavConfigPatch(raw); err == nil {
			t.Errorf("非法补丁应报错：%#v", raw)
		}
	}
	if _, err := ParseWebdavConfigPatch(map[string]any{"webdavEnabled": true}); err != nil {
		t.Fatalf("合法补丁不应报错：%v", err)
	}
}

func TestApplyWebdavConfigPatchPasswordSemantics(t *testing.T) {
	db := openTestDB(t)
	cfg := testConfig(t, nil)

	// 设置口令。
	if _, err := ApplyWebdavConfigPatch(db, cfg, WebdavConfigPatch{WebdavPassword: strPtr("example-secret")}); err != nil {
		t.Fatalf("设置口令失败：%v", err)
	}
	if got := ReadServerSettings(db, cfg).WebdavPassword; got != "example-secret" {
		t.Fatalf("口令未写入：%q", got)
	}
	// 空串 = 不改动。
	if _, err := ApplyWebdavConfigPatch(db, cfg, WebdavConfigPatch{WebdavPassword: strPtr("")}); err != nil {
		t.Fatalf("空串应视为不改动：%v", err)
	}
	if got := ReadServerSettings(db, cfg).WebdavPassword; got != "example-secret" {
		t.Fatalf("空串不应清空口令：%q", got)
	}
	// __clear__ = 清空。
	result, err := ApplyWebdavConfigPatch(db, cfg, WebdavConfigPatch{WebdavPassword: strPtr(WebdavPasswordClear)})
	if err != nil {
		t.Fatalf("清空口令失败：%v", err)
	}
	if !result.PasswordChanged || ReadServerSettings(db, cfg).WebdavPassword != "" {
		t.Fatalf("口令未清空：%+v", result)
	}
}

func TestApplyWebdavConfigPatchEnableRequiresURL(t *testing.T) {
	db := openTestDB(t)
	cfg := testConfig(t, nil)
	if _, err := ApplyWebdavConfigPatch(db, cfg, WebdavConfigPatch{WebdavEnabled: boolPtr(true)}); err == nil {
		t.Fatal("启用自动同步但无地址时应报错")
	}
	if _, err := ApplyWebdavConfigPatch(db, cfg, WebdavConfigPatch{WebdavURL: strPtr("not a url")}); err == nil {
		t.Fatal("非法地址应报错")
	}
}

func strPtr(v string) *string { return &v }
func boolPtr(v bool) *bool    { return &v }
