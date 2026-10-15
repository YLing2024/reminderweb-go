/**
 * 首页与详情页共享的分组排序逻辑（对齐安卓端 ReminderSortHelper）：
 * 置顶 → 各标签（按 sortOrder）→ 无标签；组内按 sortValue 升序、再按标题、再按 id。
 */
import type { ReminderItem, TagItem } from '../types/reminder';
import { calculateNextKeyDate, calculateNextTargetDate } from './calendar';
import { daysBetween, ld, tryParseLocalDate, type LocalDate } from './local-date';

export interface ReminderSectionData {
  key: string;
  title: string;
  items: ReminderItem[];
  tagColorHex: string | null;
}

const MAX_SORT_VALUE = Number.MAX_SAFE_INTEGER;

/** 与上游 reminderSortValue 一致：数值越小越靠前，未到期在前。 */
export function reminderSortValue(item: ReminderItem, today: LocalDate): number {
  switch (item.type) {
    case 'ANNUAL': {
      const keyDate = calculateNextKeyDate(item, today);
      return keyDate === null ? MAX_SORT_VALUE : daysBetween(today, keyDate);
    }
    case 'COUNT_UP': {
      const days = Math.max(0, daysBetween(tryParseLocalDate(item.date) ?? ld(1970, 1, 1), today));
      return item.notificationConfig.includeStartDay ? days + 1 : days;
    }
    case 'BIRTHDAY': {
      const nextDate = calculateNextTargetDate(item, today);
      return nextDate === null ? MAX_SORT_VALUE : daysBetween(today, nextDate);
    }
  }
}

function groupSortKey(tag: string): string {
  if (tag.trim() === '') return '#';
  return tag.charAt(0);
}

export function buildReminderSections(
  reminders: ReminderItem[],
  tags: TagItem[],
  today: LocalDate,
): ReminderSectionData[] {
  if (reminders.length === 0) return [];

  const result: ReminderSectionData[] = [];

  const pinned = reminders
    .filter((item) => item.isPinned)
    .sort((a, b) => reminderSortValue(a, today) - reminderSortValue(b, today) || a.id - b.id);
  if (pinned.length > 0) {
    result.push({ key: 'pinned', title: '置顶', items: pinned, tagColorHex: null });
  }

  const nonPinned = reminders.filter((item) => !item.isPinned);
  const grouped = new Map<string, ReminderItem[]>();
  for (const item of nonPinned) {
    const key = item.tag.trim();
    const list = grouped.get(key);
    if (list === undefined) {
      grouped.set(key, [item]);
    } else {
      list.push(item);
    }
  }

  const tagOrderMap = new Map(tags.map((tag) => [tag.name.trim().toLowerCase(), tag.sortOrder]));
  const tagColorMap = new Map(tags.map((tag) => [tag.name.trim().toLowerCase(), tag.color]));

  const sortedGroups = [...grouped.keys()].sort((tag1, tag2) => {
    const isBlank1 = tag1.trim() === '';
    const isBlank2 = tag2.trim() === '';
    if (isBlank1 && !isBlank2) return 1;
    if (!isBlank1 && isBlank2) return -1;

    const key1 = tag1.trim().toLowerCase();
    const key2 = tag2.trim().toLowerCase();
    const order1 = tagOrderMap.get(key1);
    const order2 = tagOrderMap.get(key2);

    if (order1 !== undefined && order2 !== undefined) return order1 - order2;
    if (order1 !== undefined) return -1;
    if (order2 !== undefined) return 1;

    const sortKey1 = groupSortKey(tag1).toLowerCase();
    const sortKey2 = groupSortKey(tag2).toLowerCase();
    if (sortKey1 !== sortKey2) return sortKey1 < sortKey2 ? -1 : 1;
    return tag1.toLowerCase() < tag2.toLowerCase() ? -1 : 1;
  });

  for (const tag of sortedGroups) {
    const items = (grouped.get(tag) ?? []).slice().sort(
      (a, b) =>
        reminderSortValue(a, today) - reminderSortValue(b, today) ||
        a.title.toLowerCase().localeCompare(b.title.toLowerCase()) ||
        a.id - b.id,
    );
    if (items.length === 0) continue;
    const title = tag.trim() === '' ? '无标签' : tag;
    const key = tag.trim() === '' ? 'group_uncategorized' : `group_${tag.toLowerCase()}`;
    result.push({ key, title, items, tagColorHex: tagColorMap.get(tag.trim().toLowerCase()) ?? null });
  }

  return result;
}

export function flattenReminders(reminders: ReminderItem[], tags: TagItem[], today: LocalDate): ReminderItem[] {
  return buildReminderSections(reminders, tags, today).flatMap((section) => section.items);
}
