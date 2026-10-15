import { describe, expect, it } from 'vitest';
import { makeItem } from '../test/factories';
import { ld } from './local-date';
import { EMPTY_CRITERIA, filterReminders, hasActiveCriteria } from './search';

const TODAY = ld(2026, 6, 1);

describe('hasActiveCriteria', () => {
  it('空条件不活跃', () => {
    expect(hasActiveCriteria(EMPTY_CRITERIA)).toBe(false);
  });

  it('任一条件即活跃', () => {
    expect(hasActiveCriteria({ ...EMPTY_CRITERIA, query: '生日' })).toBe(true);
    expect(hasActiveCriteria({ ...EMPTY_CRITERIA, types: ['BIRTHDAY'] })).toBe(true);
    expect(hasActiveCriteria({ ...EMPTY_CRITERIA, tags: [''] })).toBe(true);
    expect(hasActiveCriteria({ ...EMPTY_CRITERIA, dateFrom: '2026-01-01' })).toBe(true);
  });
});

describe('filterReminders', () => {
  const items = [
    makeItem({ id: 1, title: '结婚纪念日', notes: '每年都要庆祝', tag: '家庭', type: 'ANNUAL', date: '2026-05-20' }),
    makeItem({ id: 2, title: '入职', tag: '', type: 'COUNT_UP', date: '2020-03-01' }),
    makeItem({ id: 3, title: '妈妈生日', notes: '农历', tag: '家庭', type: 'BIRTHDAY', date: '1970-08-15', repeatInfo: { interval: 1, unit: 'YEAR', endDate: null } }),
    makeItem({ id: 4, title: '项目截止', tag: '工作', type: 'ANNUAL', date: '2026-12-31' }),
  ];

  it('查询匹配标题 / 备注 / 标签', () => {
    expect(filterReminders(items, { ...EMPTY_CRITERIA, query: '纪念' }, TODAY).map((i) => i.id)).toEqual([1]);
    expect(filterReminders(items, { ...EMPTY_CRITERIA, query: '庆祝' }, TODAY).map((i) => i.id)).toEqual([1]);
    expect(filterReminders(items, { ...EMPTY_CRITERIA, query: '工作' }, TODAY).map((i) => i.id)).toEqual([4]);
  });

  it('查询大小写不敏感', () => {
    const ascii = [makeItem({ id: 9, title: 'PayBill', tag: '', type: 'ANNUAL', date: '2026-06-01' })];
    expect(filterReminders(ascii, { ...EMPTY_CRITERIA, query: 'pay' }, TODAY)).toHaveLength(1);
  });

  it('类型多选过滤', () => {
    const result = filterReminders(items, { ...EMPTY_CRITERIA, types: ['BIRTHDAY', 'COUNT_UP'] }, TODAY);
    expect(result.map((i) => i.id).sort()).toEqual([2, 3]);
  });

  it('标签过滤含无标签', () => {
    expect(filterReminders(items, { ...EMPTY_CRITERIA, tags: ['家庭'] }, TODAY).map((i) => i.id).sort()).toEqual([1, 3]);
    expect(filterReminders(items, { ...EMPTY_CRITERIA, tags: [''] }, TODAY).map((i) => i.id)).toEqual([2]);
  });

  it('时间范围匹配条目日期', () => {
    expect(
      filterReminders(items, { ...EMPTY_CRITERIA, dateFrom: '2026-05-01', dateTo: '2026-05-31' }, TODAY).map((i) => i.id),
    ).toEqual([1]);
  });

  it('倒数日与生日按下一次目标日兜底匹配', () => {
    // 妈妈生日 8/15，2026 年的下一次生日落在 2026-08-15
    const result = filterReminders(
      items,
      { ...EMPTY_CRITERIA, dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      TODAY,
    );
    expect(result.map((i) => i.id)).toEqual([3]);
  });

  it('多条件按与逻辑叠加', () => {
    const result = filterReminders(
      items,
      { ...EMPTY_CRITERIA, query: '纪念', types: ['ANNUAL'], tags: ['家庭'] },
      TODAY,
    );
    expect(result.map((i) => i.id)).toEqual([1]);
  });
});
