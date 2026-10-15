import { describe, expect, it } from 'vitest';
import { buildIcs } from './ics';
import { ld } from './local-date';
import { makeItem } from '../test/factories';

const TODAY = ld(2026, 8, 31);

describe('buildIcs 提醒日历导出', () => {
  it('生成合法的 VCALENDAR 骨架与 CRLF 行尾', () => {
    const ics = buildIcs([makeItem({ id: 1, title: '元旦', date: '2026-12-31' })], TODAY, new Date(2026, 8, 1, 12, 0, 0));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//ReminderWeb//Reminder//CN');
  });

  it('全天事件取下一个目标日，DTEND 为次日（不含）', () => {
    const ics = buildIcs([makeItem({ id: 3, title: '元旦', date: '2026-12-31' })], TODAY);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231');
    expect(ics).toContain('DTEND;VALUE=DATE:20270101');
    expect(ics).toContain('UID:reminder-3@reminder.example.com');
  });

  it('标题中的逗号/分号/换行按 RFC5545 转义', () => {
    const ics = buildIcs([makeItem({ id: 4, title: 'a,b;c\nd', date: '2026-12-31' })], TODAY);
    expect(ics).toContain('SUMMARY:a\\,b\\;c\\nd');
  });

  it('启用提醒时附带 VALARM，TRIGGER 按提前天与时刻生成', () => {
    const item = makeItem({
      id: 5,
      title: '会议',
      date: '2026-12-31',
      notificationConfig: {
        isEnabled: true,
        useAppNotification: true,
        useSystemCalendar: false,
        isContinuous: false,
        includeStartDay: true,
        notificationTimes: [{ daysBefore: 2, time: '09:30:00' }],
      },
    });
    const ics = buildIcs([item], TODAY);
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-P2DT9H30M0S');
    expect(ics).toContain('END:VALARM');
  });

  it('已过且不重复的条目被跳过，不产生空 VEVENT', () => {
    const past = makeItem({ id: 6, title: '过期', date: '2026-01-01', repeatInfo: null });
    const ics = buildIcs([past], TODAY);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('按年重复的条目推进到下一个目标年', () => {
    const item = makeItem({ id: 7, title: '周年', date: '2020-06-01', repeatInfo: { interval: 1, unit: 'YEAR', endDate: null } });
    const ics = buildIcs([item], TODAY);
    expect(ics).toContain('DTSTART;VALUE=DATE:20270601');
  });
});
