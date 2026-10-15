import { createReminderItem, type ReminderItem } from '../types/reminder';

export function makeItem(overrides: Partial<ReminderItem> = {}): ReminderItem {
  return createReminderItem({
    title: '测试',
    date: '2026-01-01',
    type: 'ANNUAL',
    ...overrides,
  });
}
