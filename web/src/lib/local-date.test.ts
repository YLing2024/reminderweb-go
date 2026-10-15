import { describe, expect, it } from 'vitest';
import {
  DateParseError,
  daysBetween,
  formatGregorianDate,
  isAfter,
  isBefore,
  isEqual,
  ld,
  parseLocalDate,
  plusDays,
  plusMonths,
  plusWeeks,
  plusYears,
  toISODate,
  tryParseLocalDate,
  weekdayChinese,
} from './local-date';

describe('local-date 基础运算', () => {
  it('parse / toISO 往返一致', () => {
    expect(toISODate(parseLocalDate('2026-08-31'))).toBe('2026-08-31');
    expect(parseLocalDate('2026-08-31')).toEqual(ld(2026, 8, 31));
  });

  it('非法日期抛错', () => {
    expect(() => parseLocalDate('2026-13-01')).toThrow();
    expect(() => parseLocalDate('2026-02-30')).toThrow();
    expect(() => parseLocalDate('not-a-date')).toThrow();
  });

  it('非法输入抛可捕获的业务错误（DateParseError），不抛裸 Error', () => {
    expect(() => parseLocalDate(undefined)).toThrow(DateParseError);
    expect(() => parseLocalDate(null)).toThrow(DateParseError);
    expect(() => parseLocalDate('')).toThrow(DateParseError);
  });

  it('tryParseLocalDate 对 undefined/null/非法串返回 null，绝不抛异常', () => {
    expect(tryParseLocalDate(undefined)).toBeNull();
    expect(tryParseLocalDate(null)).toBeNull();
    expect(tryParseLocalDate('')).toBeNull();
    expect(tryParseLocalDate('2026-13-01')).toBeNull();
    expect(tryParseLocalDate('2026-02-30')).toBeNull();
    expect(tryParseLocalDate('not-a-date')).toBeNull();
    expect(tryParseLocalDate(20261007)).toBeNull();
    expect(tryParseLocalDate('2026-10-07')).toEqual(ld(2026, 10, 7));
  });

  it('daysBetween 与方向', () => {
    expect(daysBetween(ld(2026, 1, 1), ld(2026, 1, 31))).toBe(30);
    expect(daysBetween(ld(2026, 1, 31), ld(2026, 1, 1))).toBe(-30);
    expect(daysBetween(ld(2026, 8, 31), ld(2026, 12, 31))).toBe(122);
  });

  it('plusDays / plusWeeks 跨月', () => {
    expect(toISODate(plusDays(ld(2026, 1, 31), 1))).toBe('2026-02-01');
    expect(toISODate(plusWeeks(ld(2026, 1, 1), 2))).toBe('2026-01-15');
  });

  it('plusMonths 向月末收敛（非 JS Date 溢出）', () => {
    expect(toISODate(plusMonths(ld(2026, 1, 31), 1))).toBe('2026-02-28');
    expect(toISODate(plusMonths(ld(2024, 1, 31), 1))).toBe('2024-02-29');
    expect(toISODate(plusMonths(ld(2026, 8, 31), 6))).toBe('2027-02-28');
  });

  it('plusYears 处理 2 月 29 日', () => {
    expect(toISODate(plusYears(ld(2024, 2, 29), 1))).toBe('2025-02-28');
    expect(toISODate(plusYears(ld(2024, 2, 29), 4))).toBe('2028-02-29');
  });

  it('比较函数', () => {
    expect(isBefore(ld(2026, 1, 1), ld(2026, 1, 2))).toBe(true);
    expect(isAfter(ld(2026, 1, 2), ld(2026, 1, 1))).toBe(true);
    expect(isEqual(ld(2026, 1, 1), ld(2026, 1, 1))).toBe(true);
  });

  it('星期与日期格式化', () => {
    expect(weekdayChinese(ld(2026, 8, 31))).toBe('一');
    expect(formatGregorianDate(ld(2026, 8, 31))).toBe('2026-08-31 星期一');
  });
});
