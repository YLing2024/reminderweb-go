import { describe, expect, it } from 'vitest';
import { collectDueNotifications } from './notifications';
import { toISODate, todayLocalDate } from './local-date';
import { makeItem } from '../test/factories';

function at(hours: number, minutes: number): Date {
  const now = new Date();
  now.setHours(hours, minutes, 0, 0);
  return now;
}

const TODAY_ISO = toISODate(todayLocalDate());

function itemWith(times: Array<{ daysBefore: number; time: string }>, overrides: Parameters<typeof makeItem>[0] = {}) {
  return makeItem({
    date: TODAY_ISO,
    notificationConfig: {
      isEnabled: true,
      useAppNotification: true,
      useSystemCalendar: false,
      isContinuous: false,
      includeStartDay: true,
      notificationTimes: times,
    },
    ...overrides,
  });
}

describe('collectDueNotifications 到点提醒', () => {
  it('同一天已到点、未弹过时产生提醒', () => {
    const due = collectDueNotifications([itemWith([{ daysBefore: 0, time: '00:00:00' }])], { notificationEnabled: true }, new Set(), at(12, 0));
    expect(due).toHaveLength(1);
    expect(due[0]!.title).toBe('测试');
    expect(due[0]!.key).toBe(`0|${TODAY_ISO}|00:00:00`);
  });

  it('未到时刻不提醒', () => {
    const due = collectDueNotifications([itemWith([{ daysBefore: 0, time: '23:59:00' }])], { notificationEnabled: true }, new Set(), at(8, 0));
    expect(due).toHaveLength(0);
  });

  it('已弹过的 key 不重复提醒', () => {
    const key = `0|${TODAY_ISO}|00:00:00`;
    const due = collectDueNotifications([itemWith([{ daysBefore: 0, time: '00:00:00' }])], { notificationEnabled: true }, new Set([key]), at(12, 0));
    expect(due).toHaveLength(0);
  });

  it('应用内通知总开关关闭时不提醒', () => {
    const due = collectDueNotifications([itemWith([{ daysBefore: 0, time: '00:00:00' }])], { notificationEnabled: false }, new Set(), at(12, 0));
    expect(due).toHaveLength(0);
  });

  it('条目未启用或不用应用内通知时跳过', () => {
    const disabledItem = makeItem({
      date: TODAY_ISO,
      notificationConfig: {
        isEnabled: false,
        useAppNotification: true,
        useSystemCalendar: false,
        isContinuous: false,
        includeStartDay: true,
        notificationTimes: [{ daysBefore: 0, time: '00:00:00' }],
      },
    });
    expect(collectDueNotifications([disabledItem], { notificationEnabled: true }, new Set(), at(12, 0))).toHaveLength(0);
  });

  it('提前 N 天：到期日等于目标日减 N 天', () => {
    const due = collectDueNotifications([itemWith([{ daysBefore: 1, time: '00:00:00' }])], { notificationEnabled: true }, new Set(), at(12, 0));
    // 目标是今天，提前 1 天 → 应为昨天，今天不提醒。
    expect(due).toHaveLength(0);
  });
});
