import { describe, expect, it } from 'vitest';
import {
  fromAndroidReminder,
  fromAndroidReminderList,
  fromAndroidTag,
  stripSyncMeta,
} from './android-shape';

/** 安卓 v3.4.0 `kotlinx.serialization`（encodeDefaults=false）实测导出：只有 7 个 key。 */
function androidItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 1, title: '春节', date: '2026-02-17', type: 'ANNUAL', tag: '节日', isLunar: true, isPinned: false, ...overrides };
}

describe('fromAndroidReminder：安卓最简条目 → 内部完整条目', () => {
  it('7 个 key 的条目补齐缺失字段（与 normalize 默认一致）', () => {
    const item = fromAndroidReminder(androidItem());
    expect(item.endDate).toBeNull();
    expect(item.repeatInfo).toBeNull();
    expect(item.notes).toBe('');
    expect(item.notificationConfig.notificationTimes).toEqual([]);
    expect(item.cardBackgroundType).toBe('DEFAULT');
    expect(item.customFontWeight).toBe(700);
    expect(item.title).toBe('春节');
  });

  it('isLunar / isPinned 正确映射且中文标题、农历标记不丢', () => {
    const lunar = fromAndroidReminder(androidItem({ isLunar: true, isPinned: true, title: '中秋' }));
    expect(lunar.isLunar).toBe(true);
    expect(lunar.isPinned).toBe(true);
    expect(lunar.title).toBe('中秋');

    const solar = fromAndroidReminder(androidItem({ isLunar: false, isPinned: false }));
    expect(solar.isLunar).toBe(false);
    expect(solar.isPinned).toBe(false);
  });

  it('兼容 lunar / pinned 旧拼写（规范字段优先）', () => {
    const legacy = fromAndroidReminder({ id: 2, title: '旧拼写', lunar: true, pinned: true });
    expect(legacy.isLunar).toBe(true);
    expect(legacy.isPinned).toBe(true);

    const preferCanonical = fromAndroidReminder({ id: 3, lunar: true, isLunar: false });
    expect(preferCanonical.isLunar).toBe(false);
  });

  it('updatedAt 由调用方传入且同批同值；不传则不写入', () => {
    const withTime = fromAndroidReminder(androidItem(), 1_700_000_000_000);
    expect(withTime.updatedAt).toBe(1_700_000_000_000);
    expect(fromAndroidReminder(androidItem()).updatedAt).toBeUndefined();
  });

  it('未知字段（液态玻璃 / 未来字段）原样保留', () => {
    const item = fromAndroidReminder(androidItem({ customGlassHighlight: 0.42, futureField: { a: 1 } }));
    expect(item.customGlassHighlight).toBe(0.42);
    expect((item as Record<string, unknown>).futureField).toEqual({ a: 1 });
  });

  it('列表转换非数组按空处理', () => {
    expect(fromAndroidReminderList('nope')).toEqual([]);
    expect(fromAndroidReminderList([androidItem({ id: 1 })], 5)[0]?.updatedAt).toBe(5);
  });
});

describe('fromAndroidTag / stripSyncMeta', () => {
  it('标签补齐默认值并注入 updatedAt', () => {
    const tag = fromAndroidTag({ id: 2, name: '节日' }, 99);
    expect(tag).toEqual({ id: 2, name: '节日', color: '#2196F3', sortOrder: 0, updatedAt: 99 });
  });

  it('stripSyncMeta 去掉 updatedAt 且不修改原对象', () => {
    const source = { id: 1, title: 'x', updatedAt: 123 };
    const stripped = stripSyncMeta(source);
    expect(stripped).toEqual({ id: 1, title: 'x' });
    expect('updatedAt' in stripped).toBe(false);
    expect(source.updatedAt).toBe(123);
  });
});
