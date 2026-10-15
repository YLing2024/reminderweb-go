/**
 * 生日语义（对齐安卓端 BirthdayCalculator）：
 * 下一次生日、年龄、生肖、星座；公历与农历两种口径；处理 2 月 29 日与农历闰月。
 */
import { daysBetween, isAfter, plusYears, type LocalDate } from './local-date';
import { lunarDayExists, lunarToSolar, solarToLunar, type LunarDate } from './lunar';

export interface BirthdayInfo {
  age: number;
  chineseZodiac: string;
  zodiac: string;
}

export interface BirthdayListItem {
  age: number;
  dayCount: number;
  isPast: boolean;
  targetDate: LocalDate;
}

// 与上游 BirthdayCalculator.CHINESE_ZODIAC 一致。
const CHINESE_ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'] as const;

// 与上游 ZODIAC_SIGNS 一致（索引 = 月份-1，threshold 取该索引的值）。
const ZODIAC_NAMES = [
  '摩羯座', '水瓶座', '双鱼座', '白羊座', '金牛座', '双子座', '巨蟹座',
  '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座',
] as const;
const ZODIAC_THRESHOLDS = [19, 20, 19, 21, 20, 21, 22, 22, 22, 23, 23, 22, 22] as const;

function getZodiacSign(month: number, day: number): string {
  const threshold = ZODIAC_THRESHOLDS[month - 1] ?? 19;
  if (day <= threshold) {
    return ZODIAC_NAMES[month - 1] ?? '摩羯座';
  }
  if (month < 12) {
    return ZODIAC_NAMES[month] ?? '摩羯座';
  }
  return '摩羯座';
}

function getChineseZodiac(birthDate: LocalDate): string {
  const lunarYear = solarToLunar(birthDate).year;
  const index = (((lunarYear - 4) % 12) + 12) % 12;
  return CHINESE_ZODIAC[index] ?? '鼠';
}

function findLunarDay(lunarYear: number, month: number, startDay: number): LunarDate | null {
  for (let day = startDay; day > 0; day -= 1) {
    if (lunarDayExists(lunarYear, month, day)) {
      return { year: lunarYear, month, day };
    }
  }
  return null;
}

/** 农历生日在「出生后第 yearsToAdd 个农历年」对应的公历日期。 */
export function getLunarBirthdayInYear(birthDate: LocalDate, yearsToAdd: number): LocalDate {
  const birthLunar = solarToLunar(birthDate);
  const targetLunarYear = birthLunar.year + yearsToAdd;
  const birthMonth = birthLunar.month;

  let result: LunarDate | null;
  if (birthMonth < 0) {
    // 出生于闰月：优先找目标年的同闰月；「无闰过前」则退回对应正常月。
    const normalMonth = Math.abs(birthMonth);
    result = findLunarDay(targetLunarYear, birthMonth, birthLunar.day);
    if (result === null) {
      result = findLunarDay(targetLunarYear, normalMonth, birthLunar.day);
    }
  } else {
    result = findLunarDay(targetLunarYear, birthMonth, birthLunar.day);
  }

  if (result === null) {
    return plusYears(birthDate, yearsToAdd);
  }
  return lunarToSolar(result);
}

export function calculateBirthdayInfo(birthDate: LocalDate, isLunar: boolean, today: LocalDate): BirthdayInfo {
  let age: number;
  if (isLunar) {
    const birthLunar = solarToLunar(birthDate);
    const todayLunar = solarToLunar(today);
    const lunarYearDiff = todayLunar.year - birthLunar.year;
    const birthdayThisYear = getLunarBirthdayInYear(birthDate, lunarYearDiff);
    const hasPassedThisYear = isAfter(today, birthdayThisYear);
    age = lunarYearDiff + (hasPassedThisYear ? 1 : 0);
  } else {
    const birthThisYear = plusYears(birthDate, today.year - birthDate.year);
    const baseAge = today.year - birthDate.year;
    age = isAfter(today, birthThisYear) ? baseAge + 1 : baseAge;
  }

  return {
    age,
    chineseZodiac: getChineseZodiac(birthDate),
    zodiac: getZodiacSign(birthDate.month, birthDate.day),
  };
}

/** 生成 age 0..150 的生日列表（农历按实际农历生日换算）。 */
export function generateBirthdayList(birthDate: LocalDate, isLunar: boolean, today: LocalDate): BirthdayListItem[] {
  const items: BirthdayListItem[] = [];
  for (let age = 0; age <= 150; age += 1) {
    const targetDate = isLunar ? getLunarBirthdayInYear(birthDate, age) : plusYears(birthDate, age);
    const dayCount = daysBetween(today, targetDate);
    items.push({ age, dayCount, isPast: dayCount < 0, targetDate });
  }
  return items;
}
