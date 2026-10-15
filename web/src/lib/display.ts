/**
 * 卡片/详情展示信息（对齐安卓端 reminderDisplayInfo）：
 * 依据类型与区间阶段，给出顶部小标题、超大天数、底部日期带。
 */
import type { ReminderItem } from '../types/reminder';
import { calculateNextTargetDate, formatLunarDate, formatLunarDateShort, resolveIntervalStage } from './calendar';
import { daysBetween, formatGregorianDate, ld, tryParseLocalDate, weekdayChinese, type LocalDate } from './local-date';

function itemStart(item: ReminderItem): LocalDate {
  return tryParseLocalDate(item.date) ?? ld(1970, 1, 1);
}

export interface ReminderDisplayInfo {
  /** 顶部色带文字：`title + 空格 + suffix`（如「事件 生日就是」）。 */
  headerTitle: string;
  suffix: string;
  dayCount: number;
  isToday: boolean;
  /** 底部日期带。 */
  referenceText: string;
  /** 区间事件副标题（共 N 天 · 还剩 M 天），非区间为 null。 */
  intervalSubText: string | null;
}

function formatReferenceDate(date: LocalDate, useLunar: boolean, shortFormat: boolean): string {
  if (useLunar) {
    // 长格式（formatLunarDate）本身已含「星期X」；短格式（formatLunarDateShort）只到「月日」，
    // 按修正单要求补上「星期X」，保证底带信息完整。
    const base = shortFormat ? formatLunarDateShort(date) : formatLunarDate(date);
    return base.includes('星期') ? base : `${base} 星期${weekdayChinese(date)}`;
  }
  return formatGregorianDate(date);
}

export function buildHeaderTitle(title: string, suffix: string): string {
  return [title.trim(), suffix.trim()].filter((part) => part.length > 0).join(' ');
}

/**
 * 把底带文案拆成「日期前缀」与「星期X」，保证缩窄时丢的是前缀而不是星期。
 * 农历卡片前缀去掉年份（对齐上游 formatLunarDateShort/getLunarMonthDayLabel 的月日口径，
 * 如「腊月初四 星期四」），确保窄卡也不截断。
 */
export function splitReferenceText(text: string, isLunar: boolean): { prefix: string; weekday: string } {
  const match = /^(.*?)\s*(星期[日一二三四五六])$/.exec(text);
  const rawPrefix = match === null ? text : (match[1] ?? text);
  const weekday = match === null ? '' : (match[2] ?? '');
  const prefix = isLunar ? rawPrefix.replace(/^[^\s]*?年/, '') : rawPrefix;
  return { prefix, weekday };
}

export function reminderDisplayInfo(
  item: ReminderItem,
  today: LocalDate,
  useLunar: boolean = item.isLunar,
  shortFormat = false,
): ReminderDisplayInfo {
  switch (item.type) {
    case 'ANNUAL': {
      const stage = resolveIntervalStage(item, today);
      if (stage !== null) {
        const start = itemStart(item);
        const intervalEnd = tryParseLocalDate(item.endDate) ?? start;
        const periodOffset = daysBetween(start, intervalEnd);
        const referenceText = formatReferenceDate(stage.date, useLunar, shortFormat);
        const intervalSubText =
          stage.label === '第'
            ? `共${periodOffset + 1}天 · 还剩${daysBetween(today, stage.date) + 1}天`
            : stage.label === '已过'
              ? null
              : `共${periodOffset + 1}天`;
        return {
          headerTitle: buildHeaderTitle(item.title, stage.label),
          suffix: stage.label,
          dayCount: stage.dayCount,
          isToday: stage.label === '就是',
          referenceText,
          intervalSubText,
        };
      }

      const nextDate = calculateNextTargetDate(item, today);
      if (nextDate === null) {
        return {
          headerTitle: buildHeaderTitle(item.title, '已过'),
          suffix: '已过',
          dayCount: Math.max(0, daysBetween(itemStart(item), today)),
          isToday: false,
          referenceText: formatReferenceDate(itemStart(item), useLunar, shortFormat),
          intervalSubText: null,
        };
      }

      const daysRemaining = daysBetween(today, nextDate);
      const suffix = daysRemaining === 0 ? '就是' : '还有';
      return {
        headerTitle: buildHeaderTitle(item.title, suffix),
        suffix,
        dayCount: Math.max(0, daysRemaining),
        isToday: daysRemaining === 0,
        referenceText: formatReferenceDate(nextDate, useLunar, shortFormat),
        intervalSubText: null,
      };
    }

    case 'COUNT_UP': {
      const includeStartDay = item.notificationConfig.includeStartDay;
      const daysElapsed =
        Math.max(0, daysBetween(itemStart(item), today)) + (includeStartDay ? 1 : 0);
      return {
        headerTitle: buildHeaderTitle(item.title, '第'),
        suffix: '第',
        dayCount: daysElapsed,
        isToday: false,
        referenceText: formatReferenceDate(itemStart(item), useLunar, shortFormat),
        intervalSubText: null,
      };
    }

    case 'BIRTHDAY': {
      const nextDate = calculateNextTargetDate(item, today);
      if (nextDate === null) {
        return {
          headerTitle: buildHeaderTitle(item.title, '生日已过'),
          suffix: '生日已过',
          dayCount: Math.max(0, daysBetween(itemStart(item), today)),
          isToday: false,
          referenceText: formatReferenceDate(itemStart(item), useLunar, shortFormat),
          intervalSubText: null,
        };
      }
      const daysRemaining = daysBetween(today, nextDate);
      const suffix = daysRemaining === 0 ? '生日就是' : '生日还有';
      return {
        headerTitle: buildHeaderTitle(item.title, suffix),
        suffix,
        dayCount: Math.max(0, daysRemaining),
        isToday: daysRemaining === 0,
        referenceText: formatReferenceDate(nextDate, useLunar, shortFormat),
        intervalSubText: null,
      };
    }
  }
}
