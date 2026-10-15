/**
 * 轻量「本地日期」工具：以 {year, month, day} 表示，避免时区与 DST 干扰。
 *
 * 与 java.time.LocalDate 对齐：plusMonths / plusYears 在目标月无该日时向月末收敛
 * （如 1/31 + 1 月 = 2/28，2/29 + 1 年 = 2/28），而非 JS Date 的溢出进位。
 */

export interface LocalDate {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 日期解析失败时抛出的业务错误；调用方可按需捕获，不用于驱动整页崩溃。 */
export class DateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateParseError';
  }
}

export function ld(year: number, month: number, day: number): LocalDate {
  return { year, month, day };
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  const table = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) return 29;
  return table[month - 1] ?? 30;
}

export function isValidLocalDate(value: LocalDate): boolean {
  if (!Number.isInteger(value.year) || !Number.isInteger(value.month) || !Number.isInteger(value.day)) return false;
  if (value.month < 1 || value.month > 12) return false;
  return value.day >= 1 && value.day <= daysInMonth(value.year, value.month);
}

/** 安全解析：非法/缺失输入返回 null，绝不抛异常（渲染路径优先使用）。 */
export function tryParseLocalDate(value: unknown): LocalDate | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE_RE.exec(value);
  if (match === null) return null;
  const result = ld(Number(match[1]), Number(match[2]), Number(match[3]));
  return isValidLocalDate(result) ? result : null;
}

/**
 * 严格解析：失败抛 `DateParseError`（可被捕获的业务错误）。
 * 渲染路径请用 `tryParseLocalDate`，避免异常冒泡成整页白屏。
 */
export function parseLocalDate(value: unknown): LocalDate {
  const result = tryParseLocalDate(value);
  if (result === null) {
    throw new DateParseError(`非法日期字符串：${typeof value === 'string' ? value : String(value)}`);
  }
  return result;
}

export function toISODate(value: LocalDate): string {
  const y = String(value.year).padStart(4, '0');
  const m = String(value.month).padStart(2, '0');
  const d = String(value.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 从 JS Date 取本地日历日（用于「今天」入口，计算层不直接读时钟）。 */
export function fromJsDate(date: Date): LocalDate {
  return ld(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** 读取系统时钟得到「今天」。仅允许界面/入口层调用。 */
export function todayLocalDate(): LocalDate {
  return fromJsDate(new Date());
}

function toUtcMillis(value: LocalDate): number {
  return Date.UTC(value.year, value.month - 1, value.day);
}

/** 返回 a 与 b 的先后：a<b 为负，a>b 为正，相等为 0。 */
export function compareLocalDate(a: LocalDate, b: LocalDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

export function isBefore(a: LocalDate, b: LocalDate): boolean {
  return compareLocalDate(a, b) < 0;
}

export function isAfter(a: LocalDate, b: LocalDate): boolean {
  return compareLocalDate(a, b) > 0;
}

export function isEqual(a: LocalDate, b: LocalDate): boolean {
  return compareLocalDate(a, b) === 0;
}

/** 与 ChronoUnit.DAYS.between(from, to) 一致：to - from（天）。 */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / 86_400_000);
}

function normalize(value: LocalDate): LocalDate {
  const date = new Date(toUtcMillis(value));
  return ld(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function plusDays(value: LocalDate, amount: number): LocalDate {
  return normalize(ld(value.year, value.month, value.day + amount));
}

export function plusWeeks(value: LocalDate, amount: number): LocalDate {
  return plusDays(value, amount * 7);
}

export function plusMonths(value: LocalDate, amount: number): LocalDate {
  const total = value.year * 12 + (value.month - 1) + amount;
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  const day = Math.min(value.day, daysInMonth(year, month));
  return ld(year, month, day);
}

export function plusYears(value: LocalDate, amount: number): LocalDate {
  const year = value.year + amount;
  const day = Math.min(value.day, daysInMonth(year, value.month));
  return ld(year, value.month, day);
}

/** 周末索引：0=周日 … 6=周六（与 Map 一致）。 */
export function weekdayIndex(value: LocalDate): number {
  return new Date(toUtcMillis(value)).getUTCDay();
}

const WEEKDAY_CHINESE = ['日', '一', '二', '三', '四', '五', '六'] as const;

export function weekdayChinese(value: LocalDate): string {
  return WEEKDAY_CHINESE[weekdayIndex(value)] ?? '日';
}

/** 格式化为安卓端卡片底部样式："YYYY-MM-DD 星期X"。 */
export function formatGregorianDate(value: LocalDate): string {
  return `${toISODate(value)} 星期${weekdayChinese(value)}`;
}
