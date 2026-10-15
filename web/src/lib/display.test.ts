import { describe, expect, it } from 'vitest';
import { reminderDisplayInfo, splitReferenceText } from './display';
import { ld } from './local-date';
import type { ReminderItem, TagItem } from '../types/reminder';
import { buildReminderSections, flattenReminders, reminderSortValue } from './sort';
import { makeItem } from '../test/factories';

describe('reminderDisplayInfo 展示口径', () => {
  it('倒数日未来 → 还有', () => {
    const info = reminderDisplayInfo(makeItem({ title: '事件', date: '2026-12-31' }), ld(2026, 8, 31));
    expect(info.headerTitle).toBe('事件 还有');
    expect(info.suffix).toBe('还有');
    expect(info.dayCount).toBe(122);
    expect(info.referenceText).toBe('2026-12-31 星期四');
  });

  it('倒数日已过且不重复 → 已过', () => {
    const info = reminderDisplayInfo(makeItem({ title: '事件1', date: '2026-04-01' }), ld(2026, 8, 31));
    expect(info.headerTitle).toBe('事件1 已过');
    expect(info.dayCount).toBe(152);
    expect(info.referenceText).toBe('2026-04-01 星期三');
  });

  it('正数日 → 第 N 天（含当天）', () => {
    const info = reminderDisplayInfo(
      makeItem({ title: '事件2', type: 'COUNT_UP', date: '2026-06-01' }),
      ld(2026, 8, 31),
    );
    expect(info.headerTitle).toBe('事件2 第');
    expect(info.dayCount).toBe(92);
    expect(info.referenceText).toBe('2026-06-01 星期一');
  });

  it('正数日 -> 不含当天时减一', () => {
    const info = reminderDisplayInfo(
      makeItem({
        title: '事件2',
        type: 'COUNT_UP',
        date: '2026-06-01',
        notificationConfig: {
          isEnabled: false,
          useAppNotification: true,
          useSystemCalendar: false,
          isContinuous: false,
          includeStartDay: false,
          notificationTimes: [],
        },
      }),
      ld(2026, 8, 31),
    );
    expect(info.dayCount).toBe(91);
  });

  it('区间事件进行中 → 第 + 副标题', () => {
    const info = reminderDisplayInfo(
      makeItem({ title: '事件', date: '2026-08-01', endDate: '2026-08-31' }),
      ld(2026, 8, 31),
    );
    expect(info.headerTitle).toBe('事件 第');
    expect(info.dayCount).toBe(31);
    expect(info.intervalSubText).toBe('共31天 · 还剩1天');
  });

  it('区间事件开始日 → 就是 + 共 N 天', () => {
    const info = reminderDisplayInfo(
      makeItem({ title: '事件', date: '2026-08-01', endDate: '2026-08-31' }),
      ld(2026, 8, 1),
    );
    expect(info.headerTitle).toBe('事件 就是');
    expect(info.dayCount).toBe(0);
    expect(info.intervalSubText).toBe('共31天');
  });

  it('区间事件未开始 → 还有', () => {
    const info = reminderDisplayInfo(
      makeItem({ title: '事件', date: '2026-08-01', endDate: '2026-08-31' }),
      ld(2026, 7, 15),
    );
    expect(info.headerTitle).toBe('事件 还有');
    expect(info.dayCount).toBe(17);
  });

  it('生日当天 → 生日就是', () => {
    const info = reminderDisplayInfo(
      makeItem({
        title: '生日',
        type: 'BIRTHDAY',
        date: '1990-08-31',
        repeatInfo: { interval: 1, unit: 'YEAR', endDate: null },
      }),
      ld(2026, 8, 31),
    );
    expect(info.headerTitle).toBe('生日 生日就是');
    expect(info.dayCount).toBe(0);
  });

  it('生日未到 → 生日还有', () => {
    const info = reminderDisplayInfo(
      makeItem({
        title: '生日',
        type: 'BIRTHDAY',
        date: '1990-08-31',
        repeatInfo: { interval: 1, unit: 'YEAR', endDate: null },
      }),
      ld(2026, 8, 30),
    );
    expect(info.headerTitle).toBe('生日 生日还有');
    expect(info.dayCount).toBe(1);
  });

  it('农历口径底部日期带为农历短格式 + 星期', () => {
    const info = reminderDisplayInfo(
      makeItem({ title: '农历事件', date: '2026-08-31', isLunar: true }),
      ld(2026, 8, 1),
      true,
      true,
    );
    expect(info.referenceText).toBe('二〇二六年七月十九 星期一');
  });

  it('底带拆分：农历卡去年前缀并保留星期，公历不动', () => {
    expect(splitReferenceText('二〇二六年七月十九 星期一', true)).toEqual({
      prefix: '七月十九',
      weekday: '星期一',
    });
    expect(splitReferenceText('二〇二六年腊月初四 星期四', true)).toEqual({
      prefix: '腊月初四',
      weekday: '星期四',
    });
    expect(splitReferenceText('2026-12-31 星期四', false)).toEqual({
      prefix: '2026-12-31',
      weekday: '星期四',
    });
  });
});

function tag(id: number, name: string, sortOrder: number, color = '#2196F3'): TagItem {
  return { id, name, color, sortOrder };
}

describe('buildReminderSections 分组排序', () => {
  const today = ld(2026, 8, 31);

  const items: ReminderItem[] = [
    makeItem({ id: 1, title: '置顶B', date: '2026-12-31', isPinned: true }),
    makeItem({ id: 2, title: '置顶A', date: '2026-09-01', isPinned: true }),
    makeItem({ id: 3, title: '工作1', date: '2026-10-01', tag: '工作' }),
    makeItem({ id: 4, title: '工作0', date: '2026-09-15', tag: '工作' }),
    makeItem({ id: 5, title: '生活1', date: '2026-10-10', tag: '生活' }),
    makeItem({ id: 6, title: '无标签1', date: '2026-11-01' }),
  ];

  it('置顶组在最前，组内按到期先后', () => {
    const sections = buildReminderSections(items, [tag(1, '工作', 1), tag(2, '生活', 2)], today);
    expect(sections[0]?.key).toBe('pinned');
    expect(sections[0]?.items.map((item) => item.id)).toEqual([2, 1]);
  });

  it('标签按 sortOrder，无标签在最后', () => {
    const sections = buildReminderSections(items, [tag(1, '工作', 1), tag(2, '生活', 2)], today);
    expect(sections.map((section) => section.title)).toEqual(['置顶', '工作', '生活', '无标签']);
    expect(sections[1]?.items.map((item) => item.id)).toEqual([4, 3]);
    expect(sections[2]?.items.map((item) => item.id)).toEqual([5]);
    expect(sections[3]?.items.map((item) => item.id)).toEqual([6]);
  });

  it('未定义标签按首字排序且在有 sortOrder 的标签之后', () => {
    const extra = [...items, makeItem({ id: 7, title: '甲', date: '2026-10-02', tag: '爱好' })];
    const sections = buildReminderSections(extra, [tag(1, '工作', 1)], today);
    expect(sections.map((section) => section.title)).toEqual(['置顶', '工作', '爱好', '生活', '无标签']);
  });

  it('flatten 与分组顺序一致', () => {
    const flat = flattenReminders(items, [tag(1, '工作', 1), tag(2, '生活', 2)], today);
    expect(flat.map((item) => item.id)).toEqual([2, 1, 4, 3, 5, 6]);
  });

  it('reminderSortValue：未到期越小越靠前', () => {
    expect(reminderSortValue(makeItem({ date: '2026-09-01' }), today)).toBe(1);
    expect(reminderSortValue(makeItem({ date: '2026-12-31' }), today)).toBe(122);
    expect(reminderSortValue(makeItem({ date: '2026-01-01' }), today)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
