/**
 * 搜索过滤语义（需求 §5.4）：标题 / 备注 / 标签即时过滤 + 类型 / 标签 / 时间范围高级筛选。
 *
 * 时间范围匹配条目自身日期；对倒数日与生日，额外匹配其下一次目标日
 * （对齐上游 matchDateFilter 对 nextTargetDate 的兜底）。
 */
import type { ReminderItem, ReminderType } from '../types/reminder';
import { calculateNextTargetDate } from './calendar';
import { compareLocalDate, tryParseLocalDate, type LocalDate } from './local-date';

export interface SearchCriteria {
  query: string;
  types: ReminderType[];
  /** 选中的标签名；空字符串代表「无标签」。 */
  tags: string[];
  dateFrom: string | null; // YYYY-MM-DD
  dateTo: string | null;
}

export const EMPTY_CRITERIA: SearchCriteria = {
  query: '',
  types: [],
  tags: [],
  dateFrom: null,
  dateTo: null,
};

export function hasActiveCriteria(criteria: SearchCriteria): boolean {
  return (
    criteria.query.trim() !== '' ||
    criteria.types.length > 0 ||
    criteria.tags.length > 0 ||
    criteria.dateFrom !== null ||
    criteria.dateTo !== null
  );
}

function matchesQuery(item: ReminderItem, query: string): boolean {
  if (query === '') return true;
  const needle = query.toLowerCase();
  return (
    item.title.toLowerCase().includes(needle) ||
    item.notes.toLowerCase().includes(needle) ||
    item.tag.toLowerCase().includes(needle)
  );
}

function matchesTags(item: ReminderItem, tags: string[]): boolean {
  if (tags.length === 0) return true;
  const name = item.tag.trim();
  return tags.some((tag) => tag.toLowerCase() === name.toLowerCase());
}

function withinRange(date: LocalDate, from: LocalDate | null, to: LocalDate | null): boolean {
  if (from !== null && compareLocalDate(date, from) < 0) return false;
  if (to !== null && compareLocalDate(date, to) > 0) return false;
  return true;
}

function matchesDate(
  item: ReminderItem,
  from: LocalDate | null,
  to: LocalDate | null,
  baseDate: LocalDate,
): boolean {
  if (from === null && to === null) return true;
  const ownDate = tryParseLocalDate(item.date);
  if (ownDate === null) return false;
  if (withinRange(ownDate, from, to)) return true;
  if (item.type === 'COUNT_UP') return false;
  const nextDate = calculateNextTargetDate(item, baseDate);
  return nextDate !== null && withinRange(nextDate, from, to);
}

export function filterReminders(
  reminders: ReminderItem[],
  criteria: SearchCriteria,
  baseDate: LocalDate,
): ReminderItem[] {
  const query = criteria.query.trim();
  const from = criteria.dateFrom === null ? null : tryParseLocalDate(criteria.dateFrom);
  const to = criteria.dateTo === null ? null : tryParseLocalDate(criteria.dateTo);
  return reminders.filter((item) => {
    if (criteria.types.length > 0 && !criteria.types.includes(item.type)) return false;
    if (!matchesTags(item, criteria.tags)) return false;
    if (!matchesDate(item, from, to, baseDate)) return false;
    return matchesQuery(item, query);
  });
}
