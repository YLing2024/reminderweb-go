/**
 * 导出 .ics（§5.6 提醒方式；§8：Web 端以导出 .ics 替代写系统日历）。
 *
 * 为每条提醒生成一个全天 VEVENT，日期取「下一个目标日」（与卡片口径一致）；
 * 启用提醒的条目附带 VALARM。全部为本地构建，不依赖外部服务。
 */
import type { ReminderItem } from '../types/reminder';
import { calculateNextTargetDate } from './calendar';
import { plusDays, toISODate, type LocalDate } from './local-date';

const PRODID = '-//ReminderWeb//Reminder//CN';
const UID_DOMAIN = 'reminder.example.com';

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function toBasicDate(date: LocalDate): string {
  return toISODate(date).replace(/-/g, '');
}

function timestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** RFC5545 折行：每 75 个字符续行（用 CRLF + 空格）。 */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  return parts.join('\r\n');
}

export function buildIcs(reminders: ReminderItem[], today: LocalDate, now: Date = new Date()): string {
  const stamp = timestamp(now);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const item of reminders) {
    let start: LocalDate | null;
    try {
      start = calculateNextTargetDate(item, today);
    } catch {
      start = null;
    }
    if (start === null) continue;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:reminder-${item.id}@${UID_DOMAIN}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${toBasicDate(start)}`);
    lines.push(`DTEND;VALUE=DATE:${toBasicDate(plusDays(start, 1))}`);
    lines.push(fold(`SUMMARY:${escapeText(item.title)}`));
    if (item.notes.trim() !== '') lines.push(fold(`DESCRIPTION:${escapeText(item.notes)}`));

    const times = item.notificationConfig.notificationTimes;
    if (item.notificationConfig.isEnabled && times.length > 0) {
      const first = times[0]!;
      const [hours = '9', minutes = '0'] = first.time.split(':');
      const trigger = `-P${first.daysBefore}DT${Number(hours)}H${Number(minutes)}M0S`;
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:提醒');
      lines.push(`TRIGGER:${trigger}`);
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
