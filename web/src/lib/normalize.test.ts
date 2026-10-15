import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { FALLBACK_DATE, normalizeReminderItem, normalizeTagItem } from './normalize';
import { defaultReminderFields, type ReminderItem } from '../types/reminder';
import { buildReminderSections } from './sort';
import { todayLocalDate } from './local-date';
import { ReminderCard } from '../components/ReminderCard';

/** 真机备份里那条只有 7 个 key 的最小对象（REQUIREMENTS-M3.1 §A）。 */
const SEVEN_FIELD_ITEM = {
  id: 1,
  title: 'Android Backup Test',
  date: '2026-10-07',
  type: 'ANNUAL',
  isLunar: false,
  tag: '',
  isPinned: false,
} as const;

describe('normalizeReminderItem 完整缺省归一化', () => {
  it('7 字段最小对象 = 全字段默认值 + 该 7 字段', () => {
    const normalized = normalizeReminderItem(SEVEN_FIELD_ITEM);
    const expected: ReminderItem = { ...defaultReminderFields(), ...SEVEN_FIELD_ITEM };
    expect(normalized).toEqual(expected);
  });

  it('缺失 endDate / repeatInfo 补 null，缺 notificationConfig 补默认对象', () => {
    const normalized = normalizeReminderItem(SEVEN_FIELD_ITEM);
    expect(normalized.endDate).toBeNull();
    expect(normalized.repeatInfo).toBeNull();
    expect(normalized.notificationConfig).toEqual({
      isEnabled: false,
      useAppNotification: true,
      useSystemCalendar: false,
      isContinuous: false,
      includeStartDay: true,
      notificationTimes: [],
    });
  });

  it('缺失的数值/字符串/布尔字段落到文档默认值', () => {
    const normalized = normalizeReminderItem(SEVEN_FIELD_ITEM);
    expect(normalized.notes).toBe('');
    expect(normalized.cardBackgroundType).toBe('DEFAULT');
    expect(normalized.cardBackgroundBlurRadius).toBe(0);
    expect(normalized.cardBackgroundGlassDensity).toBe(0.5);
    expect(normalized.customFontEffect).toBe('AUTO');
    expect(normalized.customFontOpacity).toBe(1);
    expect(normalized.customFontBlur).toBe(8);
    expect(normalized.customFontWeight).toBe(700);
    expect(normalized.isCustomized).toBe(false);
  });

  it('type 缺省补 ANNUAL，非法值也回落 ANNUAL', () => {
    expect(normalizeReminderItem({ ...SEVEN_FIELD_ITEM, type: undefined }).type).toBe('ANNUAL');
    expect(normalizeReminderItem({ ...SEVEN_FIELD_ITEM, type: 'NOPE' }).type).toBe('ANNUAL');
  });

  it('非法/缺失日期回落到固定安全值且不抛异常', () => {
    expect(() => normalizeReminderItem({ ...SEVEN_FIELD_ITEM, date: undefined })).not.toThrow();
    expect(normalizeReminderItem({ ...SEVEN_FIELD_ITEM, date: undefined }).date).toBe(FALLBACK_DATE);
    expect(normalizeReminderItem({ ...SEVEN_FIELD_ITEM, date: 'not-a-date' }).date).toBe(FALLBACK_DATE);
  });

  it('安卓端未知字段（液态玻璃 / 未来字段）原样保留', () => {
    const raw = {
      ...SEVEN_FIELD_ITEM,
      cardBackgroundGlassRefraction: 0.31,
      liquidGlassFutureField: { a: 1, b: ['x', 'y'] },
    };
    const normalized = normalizeReminderItem(raw) as ReminderItem & Record<string, unknown>;
    expect(normalized.cardBackgroundGlassRefraction).toBe(0.31);
    expect(normalized.liquidGlassFutureField).toEqual({ a: 1, b: ['x', 'y'] });
  });

  it('非对象输入也能得到一份安全默认值', () => {
    const normalized = normalizeReminderItem(undefined);
    expect(normalized.type).toBe('ANNUAL');
    expect(normalized.date).toBe(FALLBACK_DATE);
    expect(normalized.notificationConfig.notificationTimes).toEqual([]);
  });
});

describe('normalizeTagItem 默认值', () => {
  it('缺 color 补 #2196F3，缺 sortOrder 补 0', () => {
    expect(normalizeTagItem({ id: 2, name: '节日' })).toEqual({
      id: 2,
      name: '节日',
      color: '#2196F3',
      sortOrder: 0,
    });
  });
});

describe('归一化后走首页渲染管线不抛错（白屏回归）', () => {
  it('7 字段提醒经归一化后可分组，且卡片 SSR 渲染出标题', () => {
    const item = normalizeReminderItem(SEVEN_FIELD_ITEM);
    const today = todayLocalDate();
    const sections = buildReminderSections([item], [], today);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.items[0]).toBe(item);

    const html = renderToString(
      createElement(ReminderCard, { item, today, onOpen: () => {} }),
    );
    expect(html).toContain('Android Backup Test');
  });

  it('未归一化（缺 endDate）的原始对象会触发白屏根因，归一化后可消除', () => {
    // 说明性断言：归一化确实把缺失字段补成了 calendar 依赖的 null。
    expect(normalizeReminderItem(SEVEN_FIELD_ITEM).endDate).toBeNull();
  });
});
