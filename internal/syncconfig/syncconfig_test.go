package syncconfig

import "testing"

func TestNormalizeInterval(t *testing.T) {
	for _, allowed := range SyncIntervals {
		if got := NormalizeInterval(allowed); got != allowed {
			t.Errorf("NormalizeInterval(%d) = %d", allowed, got)
		}
	}
	if got := NormalizeInterval(7); got != defaultInterval {
		t.Errorf("非法间隔应回落 %d，得到 %d", defaultInterval, got)
	}
}

func TestNormalizeKeep(t *testing.T) {
	if got := NormalizeKeep(0); got != SyncKeepMin {
		t.Errorf("过小保留份数应回落 %d，得到 %d", SyncKeepMin, got)
	}
	if got := NormalizeKeep(999); got != SyncKeepMax {
		t.Errorf("过大保留份数应回落 %d，得到 %d", SyncKeepMax, got)
	}
	if got := NormalizeKeep(20); got != 20 {
		t.Errorf("合法保留份数应原样返回，得到 %d", got)
	}
}

func TestParseSyncConfigPatch(t *testing.T) {
	if _, err := ParseSyncConfigPatch(map[string]any{}); err == nil {
		t.Fatal("空补丁应报错")
	}
	if _, err := ParseSyncConfigPatch(map[string]any{"intervalMinutes": 7}); err == nil {
		t.Fatal("非白名单间隔应报错")
	}
	if _, err := ParseSyncConfigPatch(map[string]any{"keep": 51}); err == nil {
		t.Fatal("越界保留份数应报错")
	}
	patch, err := ParseSyncConfigPatch(map[string]any{"enabled": true, "intervalMinutes": 30, "keep": 20})
	if err != nil {
		t.Fatalf("合法补丁报错：%v", err)
	}
	if patch.Enabled == nil || !*patch.Enabled || patch.IntervalMinutes == nil || *patch.IntervalMinutes != 30 || patch.Keep == nil || *patch.Keep != 20 {
		t.Fatalf("补丁解析错误：%+v", patch)
	}
}

func TestSyncConfigViewHidesURLWhenDisabled(t *testing.T) {
	disabled := SyncConfigViewFor(StoredSyncConfig{Enabled: false, IntervalMinutes: 10, Keep: 10}, "https://dav.example.com/dav/")
	if disabled.URL != "" {
		t.Fatalf("未启用时 URL 应为空，得到 %q", disabled.URL)
	}
	enabled := SyncConfigViewFor(StoredSyncConfig{Enabled: true, IntervalMinutes: 10, Keep: 10}, "https://dav.example.com/dav/")
	if enabled.URL != "https://dav.example.com/dav/" {
		t.Fatalf("启用时应返回 URL，得到 %q", enabled.URL)
	}
	if len(enabled.Options.Intervals) != len(SyncIntervals) || enabled.Options.KeepRange != [2]int{SyncKeepMin, SyncKeepMax} {
		t.Fatalf("选项声明错误：%+v", enabled.Options)
	}
}
