import { describe, expect, it } from 'vitest';
import { BIRTHDAY_REPEAT, applyTypeDefaults } from './reminder-rules';
import { createReminderItem } from '../types/reminder';
import { makeItem } from '../test/factories';

describe('applyTypeDefaults 生日默认重复', () => {
  it('切换为生日且无重复时补「每 1 年」', () => {
    const annual = makeItem({ type: 'ANNUAL', repeatInfo: null });
    const result = applyTypeDefaults(annual, 'BIRTHDAY');
    expect(result.type).toBe('BIRTHDAY');
    expect(result.repeatInfo).toEqual(BIRTHDAY_REPEAT);
    expect(result.repeatInfo).toEqual({ interval: 1, unit: 'YEAR', endDate: null });
  });

  it('已有重复设置时保持原值', () => {
    const custom = { interval: 3, unit: 'MONTH' as const, endDate: '2030-01-01' };
    const item = makeItem({ type: 'ANNUAL', repeatInfo: custom });
    const result = applyTypeDefaults(item, 'BIRTHDAY');
    expect(result.repeatInfo).toEqual(custom);
  });

  it('切换到非生日类型时不补重复', () => {
    const item = makeItem({ type: 'ANNUAL', repeatInfo: null });
    expect(applyTypeDefaults(item, 'COUNT_UP').repeatInfo).toBeNull();
    expect(applyTypeDefaults(item, 'ANNUAL').repeatInfo).toBeNull();
  });

  it('生日条目原样返回时仍带年重复（幂等）', () => {
    const birthday = makeItem({ type: 'BIRTHDAY', repeatInfo: { interval: 1, unit: 'YEAR', endDate: null } });
    expect(applyTypeDefaults(birthday, 'BIRTHDAY').repeatInfo).toEqual(BIRTHDAY_REPEAT);
  });

  it('createReminderItem 直接构造生日时也带年重复', () => {
    const created = createReminderItem({ title: '小明', date: '2000-01-01', type: 'BIRTHDAY' });
    expect(created.repeatInfo).toEqual(BIRTHDAY_REPEAT);
  });

  it('createReminderItem 显式传入 repeatInfo 时尊重入参', () => {
    const created = createReminderItem({
      title: '小明',
      date: '2000-01-01',
      type: 'BIRTHDAY',
      repeatInfo: null,
    });
    expect(created.repeatInfo).toBeNull();
  });
});
