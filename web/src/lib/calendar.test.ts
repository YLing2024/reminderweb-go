import { describe, expect, it } from 'vitest';
import {
  calculateCurrentPeriodStart,
  calculateNextKeyDate,
  calculateNextTargetDate,
  formatLunarDate,
  formatLunarDateShort,
  getLunarMonthDayLabel,
  resolveIntervalStage,
} from './calendar';
import { ld, toISODate } from './local-date';
import { makeItem } from '../test/factories';

describe('calculateNextTargetDate 倒数日', () => {
  it('未来日期返回自身', () => {
    const item = makeItem({ date: '2026-12-31' });
    expect(calculateNextTargetDate(item, ld(2026, 8, 31))).toEqual(ld(2026, 12, 31));
  });

  it('过去且不重复返回 null', () => {
    const item = makeItem({ date: '2026-01-01' });
    expect(calculateNextTargetDate(item, ld(2026, 8, 31))).toBeNull();
  });

  it('今天返回今天', () => {
    const item = makeItem({ date: '2026-08-31' });
    expect(calculateNextTargetDate(item, ld(2026, 8, 31))).toEqual(ld(2026, 8, 31));
  });

  it('按年重复推进到下一个目标日', () => {
    const item = makeItem({
      date: '2020-06-01',
      repeatInfo: { interval: 1, unit: 'YEAR', endDate: null },
    });
    expect(calculateNextTargetDate(item, ld(2026, 8, 31))).toEqual(ld(2027, 6, 1));
  });

  it('按 3 天重复推进', () => {
    const item = makeItem({
      date: '2026-01-01',
      repeatInfo: { interval: 3, unit: 'DAY', endDate: null },
    });
    expect(calculateNextTargetDate(item, ld(2026, 1, 10))).toEqual(ld(2026, 1, 10));
    expect(calculateNextTargetDate(item, ld(2026, 1, 11))).toEqual(ld(2026, 1, 13));
  });

  it('按月重复在月末收敛', () => {
    const item = makeItem({
      date: '2026-01-31',
      repeatInfo: { interval: 1, unit: 'MONTH', endDate: null },
    });
    expect(calculateNextTargetDate(item, ld(2026, 3, 5))).toEqual(ld(2026, 3, 28));
  });
});

describe('calculateCurrentPeriodStart 区间周期起点', () => {
  it('baseDate 早于首个周期返回原始开始日', () => {
    const item = makeItem({
      date: '2026-08-01',
      endDate: '2026-08-31',
      repeatInfo: { interval: 1, unit: 'YEAR', endDate: null },
    });
    expect(calculateCurrentPeriodStart(item, ld(2026, 7, 1))).toEqual(ld(2026, 8, 1));
  });

  it('推进到 <= baseDate 的最大周期开始日', () => {
    const item = makeItem({
      date: '2025-08-01',
      endDate: '2025-08-31',
      repeatInfo: { interval: 1, unit: 'YEAR', endDate: null },
    });
    expect(calculateCurrentPeriodStart(item, ld(2026, 9, 10))).toEqual(ld(2026, 8, 1));
  });
});

describe('resolveIntervalStage 区间阶段', () => {
  const interval = makeItem({
    title: '事件',
    date: '2026-08-01',
    endDate: '2026-08-31',
    notificationConfig: {
      isEnabled: false,
      useAppNotification: true,
      useSystemCalendar: false,
      isContinuous: false,
      includeStartDay: true,
      notificationTimes: [],
    },
  });

  it('未开始 → 还有', () => {
    const stage = resolveIntervalStage(interval, ld(2026, 7, 15));
    expect(stage).toEqual({ label: '还有', dayCount: 17, date: ld(2026, 8, 1) });
  });

  it('开始日当天 → 就是', () => {
    expect(resolveIntervalStage(interval, ld(2026, 8, 1))).toEqual({ label: '就是', dayCount: 0, date: ld(2026, 8, 1) });
  });

  it('进行中 → 第（包含起始日）', () => {
    expect(resolveIntervalStage(interval, ld(2026, 8, 31))).toEqual({ label: '第', dayCount: 31, date: ld(2026, 8, 31) });
  });

  it('结束日当天仍属进行中', () => {
    const stage = resolveIntervalStage(interval, ld(2026, 8, 31));
    expect(stage?.label).toBe('第');
  });

  it('不包含起始日时起始日次日=第 1 天', () => {
    const item = makeItem({
      date: '2026-08-01',
      endDate: '2026-08-31',
      notificationConfig: {
        isEnabled: false,
        useAppNotification: true,
        useSystemCalendar: false,
        isContinuous: false,
        includeStartDay: false,
        notificationTimes: [],
      },
    });
    expect(resolveIntervalStage(item, ld(2026, 8, 2))?.dayCount).toBe(1);
  });

  it('越过结束日且不重复 → 已过', () => {
    expect(resolveIntervalStage(interval, ld(2026, 9, 10))).toEqual({ label: '已过', dayCount: 10, date: ld(2026, 8, 31) });
  });

  it('越过结束日且重复 → 滚动到下一周期还有', () => {
    const item = makeItem({
      date: '2025-08-01',
      endDate: '2025-08-31',
      repeatInfo: { interval: 1, unit: 'YEAR', endDate: null },
    });
    const stage = resolveIntervalStage(item, ld(2026, 9, 10));
    expect(stage?.label).toBe('还有');
    expect(stage?.date).toEqual(ld(2027, 8, 1));
  });

  it('endDate 早于 date → 非区间事件返回 null', () => {
    const item = makeItem({ date: '2026-08-31', endDate: '2026-08-01' });
    expect(resolveIntervalStage(item, ld(2026, 8, 31))).toBeNull();
  });

  it('非倒数日返回 null', () => {
    const item = makeItem({ type: 'COUNT_UP', endDate: '2026-08-31' });
    expect(resolveIntervalStage(item, ld(2026, 8, 31))).toBeNull();
  });
});

describe('calculateNextKeyDate 关键日', () => {
  it('区间进行中返回结束日', () => {
    const item = makeItem({ date: '2026-08-01', endDate: '2026-08-31' });
    expect(calculateNextKeyDate(item, ld(2026, 8, 15))).toEqual(ld(2026, 8, 31));
  });

  it('区间已过且不重复返回 null', () => {
    const item = makeItem({ date: '2026-08-01', endDate: '2026-08-31' });
    expect(calculateNextKeyDate(item, ld(2026, 9, 10))).toBeNull();
  });

  it('普通倒数日等价于 calculateNextTargetDate', () => {
    const item = makeItem({ date: '2026-12-31' });
    expect(calculateNextKeyDate(item, ld(2026, 8, 31))).toEqual(ld(2026, 12, 31));
  });
});

describe('农历格式化', () => {
  it('长格式带干支与星期', () => {
    expect(formatLunarDate(ld(2026, 8, 31))).toBe('丙午(2026) 七月 十九 星期一');
  });

  it('短格式带农历年', () => {
    expect(formatLunarDateShort(ld(2026, 8, 31))).toBe('二〇二六年七月十九');
  });

  it('月日标签', () => {
    expect(getLunarMonthDayLabel(ld(2026, 8, 31))).toBe('丙午(2026)年七月十九');
  });

  it('十一月 / 十二月 映射为冬月 / 腊月', () => {
    expect(formatLunarDateShort(ld(2027, 1, 2))).toContain('冬月');
    expect(formatLunarDateShort(ld(2027, 1, 10))).toContain('腊月');
  });

  it('toISODate 保持 4 位年', () => {
    expect(toISODate(ld(2026, 8, 31))).toBe('2026-08-31');
  });
});
