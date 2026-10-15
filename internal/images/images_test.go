package images

import (
	"testing"

	"reminderweb-go/internal/store/storetest"
)

func TestIsValidImageName(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"card-bg-20260101-120000-abcd.jpg", true},
		{"a.png", true},
		{"", false},
		{"..", false},
		{"a/b.jpg", false},
		{"a\\b.jpg", false},
		{"bad\x01name", false},
		{"bad\x7fname", false},
	}
	for _, tc := range cases {
		if got := IsValidImageName(tc.name); got != tc.want {
			t.Errorf("IsValidImageName(%q) = %v，期望 %v", tc.name, got, tc.want)
		}
	}
}

func TestImageCRUD(t *testing.T) {
	db := storetest.Open(t)
	q := db.SQL()

	// 空集必须是 []，不能是 nil（前端直接读 .length）。
	names, err := ReadNames(q)
	if err != nil || names == nil || len(names) != 0 {
		t.Fatalf("空图片名集应为非 nil 空切片：%v %v", names, err)
	}
	all, err := ReadAll(q)
	if err != nil || all == nil || len(all) != 0 {
		t.Fatalf("空图片集应为非 nil 空切片：%v %v", all, err)
	}

	if err := Upsert(q, "b.jpg", []byte("bb"), 1); err != nil {
		t.Fatalf("Upsert 失败：%v", err)
	}
	if err := Upsert(q, "a.jpg", []byte("aa"), 2); err != nil {
		t.Fatalf("Upsert 失败：%v", err)
	}
	if err := Upsert(q, "a.jpg", []byte("AA"), 3); err != nil {
		t.Fatalf("覆盖 Upsert 失败：%v", err)
	}
	names, err = ReadNames(q)
	if err != nil || len(names) != 2 || names[0] != "a.jpg" || names[1] != "b.jpg" {
		t.Fatalf("图片名应按升序：%v %v", names, err)
	}
	content, ok, err := Read(q, "a.jpg")
	if err != nil || !ok || string(content) != "AA" {
		t.Fatalf("覆盖后内容错误：%q %v %v", content, ok, err)
	}
	if _, ok, _ := Read(q, "missing.jpg"); ok {
		t.Fatal("不存在的图片应返回 ok=false")
	}

	deleted, err := Delete(q, "a.jpg")
	if err != nil || !deleted {
		t.Fatalf("删除应命中：%v %v", deleted, err)
	}
	deleted, err = Delete(q, "a.jpg")
	if err != nil || deleted {
		t.Fatalf("重复删除不应命中：%v %v", deleted, err)
	}

	if err := ReplaceAll(q, []StoredImage{{Name: "c.jpg", Bytes: []byte("cc")}}, 9); err != nil {
		t.Fatalf("ReplaceAll 失败：%v", err)
	}
	all, err = ReadAll(q)
	if err != nil || len(all) != 1 || all[0].Name != "c.jpg" || string(all[0].Bytes) != "cc" {
		t.Fatalf("ReplaceAll 结果错误：%+v %v", all, err)
	}
}
