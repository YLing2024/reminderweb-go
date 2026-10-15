/**
 * 天数 / 目标日 / 周期 / 区间阶段语义（对齐安卓端 CalendarUtil）：
 * 所有函数都支持注入 baseDate，不直接读系统时钟。
 */
import type { ReminderItem, RepeatInfo } from '../types/reminder';
import { getLunarBirthdayInYear } from './birthday';
import {
  daysBetween,
  isAfter,
  isBefore,
  isEqual,
  ld,
  plusDays,
  plusMonths,
  plusWeeks,
  plusYears,
  tryParseLocalDate,
  weekdayChinese,
  type LocalDate,
} from './local-date';
import { lunarDayExists, lunarDisplay, lunarToSolar, nextLunarMonth, solarToLunar } from './lunar';

export interface IntervalStage {
  /** 阶段标签：还有 / 就是 / 第 / 已过 */
  label: string;
  dayCount: number;
  date: LocalDate;
}

/** 缺失/非法日期的安全回落（固定常量，纯计算不读时钟）。 */
const FALLBACK_LOCAL_DATE = ld(1970, 1, 1);

function itemDate(item: ReminderItem): LocalDate {
  return tryParseLocalDate(item.date) ?? FALLBACK_LOCAL_DATE;
}

/** 解析可空的结束日期；缺失/非法一律返回 null，不抛异常。 */
function endLocalDate(endDate: string | null | undefined): LocalDate | null {
  return tryParseLocalDate(endDate);
}

/** 周期开始日向前滚动一步（农历年/月用农历规则，日/周按公历）。 */
function advancePeriodStart(currentDate: LocalDate, repeatInfo: RepeatInfo, isLunar: boolean): LocalDate {
  const interval = repeatInfo.interval;
  if (!isLunar) {
    switch (repeatInfo.unit) {
      case 'DAY':
        return plusDays(currentDate, interval);
      case 'WEEK':
        return plusWeeks(currentDate, interval);
      case 'MONTH':
        return plusMonths(currentDate, interval);
      case 'YEAR':
        return plusYears(currentDate, interval);
    }
  }
  switch (repeatInfo.unit) {
    case 'YEAR':
      return getNextLunarYearDate(currentDate, interval);
    case 'MONTH':
      return getNextLunarMonthDate(currentDate, interval);
    case 'DAY':
      return plusDays(currentDate, interval);
    case 'WEEK':
      return plusWeeks(currentDate, interval);
  }
}

function getNextLunarYearDate(currentSolarDate: LocalDate, interval: number): LocalDate {
  const currentLunar = solarToLunar(currentSolarDate);
  const targetYear = currentLunar.year + interval;
  for (let day = currentLunar.day; day > 0; day -= 1) {
    if (lunarDayExists(targetYear, currentLunar.month, day)) {
      return lunarToSolar({ year: targetYear, month: currentLunar.month, day });
    }
  }
  return plusYears(currentSolarDate, interval);
}

function getNextLunarMonthDate(currentSolarDate: LocalDate, interval: number): LocalDate {
  const currentLunar = solarToLunar(currentSolarDate);
  const next = nextLunarMonth(currentLunar.year, currentLunar.month, interval);
  for (let day = currentLunar.day; day > 0; day -= 1) {
    if (lunarDayExists(next.year, next.month, day)) {
      return lunarToSolar({ year: next.year, month: next.month, day });
    }
  }
  return plusMonths(currentSolarDate, interval);
}

/**
 * 下一个目标日：
 * - 无重复：日期未到返回该日期，已过返回 null；
 * - 农历生日：按农历月日匹配到今年/明年及以后；
 * - 其它重复：从起始日起按 interval × unit 推进到 >= baseDate。
 */
export function calculateNextTargetDate(item: ReminderItem, baseDate: LocalDate): LocalDate | null {
  const repeatInfo = item.repeatInfo;
  const start = itemDate(item);

  if (repeatInfo === null) {
    return isBefore(start, baseDate) ? null : start;
  }

  if (item.type === 'BIRTHDAY' && item.isLunar) {
    const birthLunar = solarToLunar(start);
    const baseLunar = solarToLunar(baseDate);
    const approximateAge = baseLunar.year - birthLunar.year;
    let age = Math.max(0, approximateAge - 1);
    while (age <= 150) {
      const birthday = getLunarBirthdayInYear(start, age);
      if (!isBefore(birthday, baseDate)) {
        return birthday;
      }
      age += 1;
    }
    return null;
  }

  let currentDate = start;
  let guard = 0;
  while (isBefore(currentDate, baseDate)) {
    const next = advancePeriodStart(currentDate, repeatInfo, item.isLunar);
    if (!isAfter(next, currentDate)) break;
    currentDate = next;
    guard += 1;
    if (guard > 100_000) break;
  }
  return currentDate;
}

/** 区间事件当前所处周期的开始日：<= baseDate 的最大周期开始日。 */
export function calculateCurrentPeriodStart(item: ReminderItem, baseDate: LocalDate): LocalDate {
  const repeatInfo = item.repeatInfo;
  if (repeatInfo === null) return itemDate(item);

  let periodStart = itemDate(item);
  let next = advancePeriodStart(periodStart, repeatInfo, item.isLunar);
  let guard = 0;
  while (!isAfter(next, baseDate)) {
    if (!isAfter(next, periodStart)) break;
    periodStart = next;
    next = advancePeriodStart(periodStart, repeatInfo, item.isLunar);
    guard += 1;
    if (guard > 100_000) break;
  }
  return periodStart;
}

/**
 * 下一个「关键日」（供排序使用，与展示文案日期口径一致）：
 * - 普通提醒（endDate == null 或非倒数日）：等价于 calculateNextTargetDate；
 * - 区间事件：未开始=周期开始日；进行中（含结束日当天）=结束日；
 *   已越过结束日时有重复=下一周期开始日、无重复=null。
 */
export function calculateNextKeyDate(item: ReminderItem, baseDate: LocalDate): LocalDate | null {
  const endDate = endLocalDate(item.endDate);
  const start = itemDate(item);
  if (item.type !== 'ANNUAL' || endDate === null || isBefore(endDate, start)) {
    return calculateNextTargetDate(item, baseDate);
  }
  const periodOffset = daysBetween(start, endDate);
  const periodStart = calculateCurrentPeriodStart(item, baseDate);
  const periodEnd = plusDays(periodStart, periodOffset);
  if (!isAfter(baseDate, periodStart)) return periodStart;
  if (!isAfter(baseDate, periodEnd)) return periodEnd;
  return item.repeatInfo !== null ? calculateNextTargetDate(item, baseDate) : null;
}

/**
 * 区间事件（ANNUAL + endDate）当前阶段；非区间事件返回 null。
 * 「还有」= 未开始或已滚动到下一周期；「就是」= 周期开始日当天；「第」= 进行中
 * （包含起始日时起始日=第 1 天）；「已过」= 无重复且已越过结束日。
 */
export function resolveIntervalStage(item: ReminderItem, baseDate: LocalDate): IntervalStage | null {
  const endDate = endLocalDate(item.endDate);
  const start = itemDate(item);
  if (item.type !== 'ANNUAL' || endDate === null || isBefore(endDate, start)) {
    return null;
  }
  const includeStartDay = item.notificationConfig.includeStartDay;
  const periodOffset = daysBetween(start, endDate);
  const periodStart = calculateCurrentPeriodStart(item, baseDate);
  const periodEnd = plusDays(periodStart, periodOffset);

  if (isBefore(baseDate, periodStart)) {
    return { label: '还有', dayCount: daysBetween(baseDate, periodStart), date: periodStart };
  }
  if (isEqual(baseDate, periodStart)) {
    return { label: '就是', dayCount: 0, date: periodStart };
  }
  if (!isAfter(baseDate, periodEnd)) {
    return {
      label: '第',
      dayCount: daysBetween(periodStart, baseDate) + (includeStartDay ? 1 : 0),
      date: periodEnd,
    };
  }
  if (item.repeatInfo !== null) {
    const nextDate = calculateNextTargetDate(item, baseDate) ?? periodStart;
    return { label: '还有', dayCount: Math.max(0, daysBetween(baseDate, nextDate)), date: nextDate };
  }
  return { label: '已过', dayCount: Math.max(0, daysBetween(periodEnd, baseDate)), date: periodEnd };
}

/** 格式化为安卓端长农历样式："干支(年) 月 日 星期X"。 */
export function formatLunarDate(date: LocalDate): string {
  const display = lunarDisplay(date);
  return `${display.ganZhi}(${display.year}) ${display.monthLabel} ${display.dayLabel} 星期${weekdayChinese(date)}`;
}

/** 短农历样式："二〇二六年七月十九"。 */
export function formatLunarDateShort(date: LocalDate): string {
  const display = lunarDisplay(date);
  return `${display.yearChinese}年${display.monthLabel}${display.dayLabel}`;
}

/** 农历月日标签："丙午(2026)年七月十九"。 */
export function getLunarMonthDayLabel(date: LocalDate): string {
  const display = lunarDisplay(date);
  return `${display.ganZhi}(${display.year})年${display.monthLabel}${display.dayLabel}`;
}
