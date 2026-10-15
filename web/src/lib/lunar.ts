/**
 * lunar-javascript（6tail，与安卓端 tyme4kt 同源生态）的最小封装。
 *
 * 农历数据表体积较大（约 300KB），为把首屏 gzip 压回 §9 的 200KB 目标，
 * 这里改为**按需加载**：模块自身不静态引入 lunar-javascript，而是由
 * `ensureLunar()` 在真正需要农历计算时动态 import。调用方在触发计算前
 * 需保证 `isLunarReady()` 为真（界面用 `LunarGate` / `useLunarReady` 兜底）。
 *
 * 农历月用负数表示闰月（与 lunar-javascript / tyme 一致）：
 * 例如 2023 年闰二月 → month = -2。
 */
import type * as LunarJs from 'lunar-javascript';
import { ld, toISODate, type LocalDate } from './local-date';

type LunarModule = typeof LunarJs;

let lunarModule: LunarModule | null = null;
let loadingPromise: Promise<void> | null = null;
const readyListeners = new Set<() => void>();

/** 农历模块是否已载入（已可同步调用下方函数）。 */
export function isLunarReady(): boolean {
  return lunarModule !== null;
}

/** 动态载入 lunar-javascript；重复调用返回同一个 Promise。 */
export function ensureLunar(): Promise<void> {
  if (lunarModule !== null) return Promise.resolve();
  if (loadingPromise === null) {
    loadingPromise = import('lunar-javascript').then((mod) => {
      lunarModule = mod;
      for (const listener of readyListeners) listener();
    });
  }
  return loadingPromise;
}

/** 订阅农历模块载入完成事件（供 useSyncExternalStore 使用）。 */
export function subscribeLunar(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

function lj(): LunarModule {
  if (lunarModule === null) {
    throw new Error('农历模块尚未载入，请先 await ensureLunar()');
  }
  return lunarModule;
}

export interface LunarDate {
  readonly year: number;
  readonly month: number; // 负数表示闰月
  readonly day: number;
}

export function solarToLunar(date: LocalDate): LunarDate {
  const lunar = lj().Solar.fromYmd(date.year, date.month, date.day).getLunar();
  return { year: lunar.getYear(), month: lunar.getMonth(), day: lunar.getDay() };
}

export function lunarToSolar(value: LunarDate): LocalDate {
  const solar = lj().Lunar.fromYmd(value.year, value.month, value.day).getSolar();
  return ld(solar.getYear(), solar.getMonth(), solar.getDay());
}

/** 目标农历月是否在给定年份存在（用于闰月「无闰过前」逻辑）。 */
export function lunarMonthExists(year: number, month: number): boolean {
  try {
    lj().LunarMonth.fromYm(year, month);
    return true;
  } catch {
    return false;
  }
}

/** 农历日是否存在（日号超出该月天数时返回 false）。 */
export function lunarDayExists(year: number, month: number, day: number): boolean {
  try {
    lj().Lunar.fromYmd(year, month, day);
    return true;
  } catch {
    return false;
  }
}

/** 农历月前进 amount 个月（可能跨越闰月），返回 {year, month}。 */
export function nextLunarMonth(year: number, month: number, amount: number): { year: number; month: number } {
  const next = lj().LunarMonth.fromYm(year, month).next(amount);
  return { year: next.getYear(), month: next.getMonth() };
}

export function lunarYearGanZhi(year: number): string {
  // 以该农历年正月初一为代表日取干支纪年。
  return lj().Lunar.fromYmd(year, 1, 1).getYearInGanZhi();
}

export function lunarYearChinese(year: number): string {
  return lj().Lunar.fromYmd(year, 1, 1).getYearInChinese();
}

/** 农历月名（已做「冬月 / 腊月 / 闰冬月 / 闰腊月」映射），如「七月」「闰二月」「冬月」。 */
export function lunarMonthLabel(lunarYear: number, month: number): string {
  const raw = `${lj().Lunar.fromYmd(lunarYear, month, 1).getMonthInChinese()}月`;
  return mapMonthLabel(raw);
}

function mapMonthLabel(raw: string): string {
  switch (raw) {
    case '十一月':
      return '冬月';
    case '十二月':
      return '腊月';
    case '闰十一月':
      return '闰冬月';
    case '闰十二月':
      return '闰腊月';
    default:
      return raw;
  }
}

export function lunarDayLabel(year: number, month: number, day: number): string {
  return lj().Lunar.fromYmd(year, month, day).getDayInChinese();
}

export interface LunarDisplay {
  year: number;
  month: number;
  day: number;
  ganZhi: string;
  yearChinese: string;
  monthLabel: string;
  dayLabel: string;
}

/** 一次取齐某个公历日对应的农历展示字段（干支纪年、月名、日名）。 */
export function lunarDisplay(date: LocalDate): LunarDisplay {
  const lunar = lj().Solar.fromYmd(date.year, date.month, date.day).getLunar();
  return {
    year: lunar.getYear(),
    month: lunar.getMonth(),
    day: lunar.getDay(),
    ganZhi: lunar.getYearInGanZhi(),
    yearChinese: lunar.getYearInChinese(),
    monthLabel: mapMonthLabel(`${lunar.getMonthInChinese()}月`),
    dayLabel: lunar.getDayInChinese(),
  };
}

export interface LunarMonthOption {
  /** 负数表示闰月。 */
  month: number;
  label: string;
  dayCount: number;
}

/** 某农历年的全部月份（含闰月）。 */
export function lunarMonthsOfYear(lunarYear: number): LunarMonthOption[] {
  return lj()
    .LunarYear.fromYear(lunarYear)
    .getMonthsInYear()
    .map((month) => ({
      month: month.getMonth(),
      label: lunarMonthLabel(month.getYear(), month.getMonth()),
      dayCount: month.getDayCount(),
    }));
}

/** 公立年份对应的农历年（取该年春节所在农历年）。 */
export function lunarYearForSolarYear(solarYear: number): number {
  return solarToLunar(ld(solarYear, 7, 1)).year;
}

export { toISODate };
