import { describe, expect, it } from 'vitest';
import { calculateBirthdayInfo, generateBirthdayList, getLunarBirthdayInYear } from './birthday';
import { calculateNextTargetDate } from './calendar';
import { ld } from './local-date';
import { makeItem } from '../test/factories';

describe('公历生日', () => {
  it('年龄按是否已过生日计算', () => {
    expect(calculateBirthdayInfo(ld(1990, 8, 31), false, ld(2026, 8, 31)).age).toBe(36);
    expect(calculateBirthdayInfo(ld(1990, 8, 31), false, ld(2026, 9, 1)).age).toBe(37);
  });

  it('星座与生肖', () => {
    const info = calculateBirthdayInfo(ld(1990, 8, 31), false, ld(2026, 8, 31));
    expect(info.zodiac).toBe('处女座');
    expect(info.chineseZodiac).toBe('马');
  });

  it('2 月 29 日在非闰年收敛到 2 月 28 日', () => {
    expect(calculateBirthdayInfo(ld(2004, 2, 29), false, ld(2026, 2, 27)).age).toBe(22);
    expect(calculateBirthdayInfo(ld(2004, 2, 29), false, ld(2026, 3, 1)).age).toBe(23);
  });

  it('generateBirthdayList 覆盖 0..150 岁', () => {
    const list = generateBirthdayList(ld(1990, 8, 31), false, ld(2026, 8, 31));
    expect(list).toHaveLength(151);
    expect(list[0]?.targetDate).toEqual(ld(1990, 8, 31));
    expect(list[36]?.targetDate).toEqual(ld(2026, 8, 31));
    expect(list[36]?.dayCount).toBe(0);
    expect(list[36]?.isPast).toBe(false);
    expect(list[37]?.targetDate).toEqual(ld(2027, 8, 31));
  });
});

describe('农历生日', () => {
  it('农历年龄按农历年差计算', () => {
    // 1990-08-31 = 农历 1990 年七月十二；2026-08-31 = 农历 2026 年七月十九。
    expect(calculateBirthdayInfo(ld(1990, 8, 31), true, ld(2026, 8, 31)).age).toBe(37);
  });

  it('getLunarBirthdayInYear 定位当年农历生日', () => {
    expect(getLunarBirthdayInYear(ld(1990, 8, 31), 36)).toEqual(ld(2026, 8, 24));
  });

  it('闰月出生在无闰年回退到正常月', () => {
    // 2023-03-22 = 农历 2023 年闰二月初一；2024 无闰二月 → 二月初一 = 2024-03-10。
    expect(getLunarBirthdayInYear(ld(2023, 3, 22), 1)).toEqual(ld(2024, 3, 10));
  });

  it('农历三十在只有廿九的月份收敛到廿九', () => {
    // 2020-05-22 = 农历 2020 年四月三十；2026 年四月只有 29 天 → 2026-04-29 = 2026-06-14。
    expect(getLunarBirthdayInYear(ld(2020, 5, 22), 6)).toEqual(ld(2026, 6, 14));
  });

  it('农历生日作为下一个目标日', () => {
    const item = makeItem({
      type: 'BIRTHDAY',
      date: '1990-08-31',
      isLunar: true,
      repeatInfo: { interval: 1, unit: 'YEAR', endDate: null },
    });
    expect(calculateNextTargetDate(item, ld(2026, 8, 31))).toEqual(ld(2027, 8, 13));
  });

  it('农历生日当天返回当天', () => {
    const item = makeItem({
      type: 'BIRTHDAY',
      date: '1990-08-31',
      isLunar: true,
      repeatInfo: { interval: 1, unit: 'YEAR', endDate: null },
    });
    expect(calculateNextTargetDate(item, ld(2026, 8, 24))).toEqual(ld(2026, 8, 24));
  });
});
