/**
 * 到点提醒调度（§5.6 / §8）：
 * - 页面打开时轮询检查到期提醒，用 Notification API 弹出；
 * - 优先经 Service Worker 展示（页面后台/关闭时也能兜底），不可用时退回 new Notification；
 * - 权限未授予时静默跳过，由设置页引导申请。
 *
 * 计算依赖农历（calculateNextTargetDate），调用前会 ensureLunar()。
 */
import { useEffect } from 'react';
import type { ReminderItem } from '../types/reminder';
import type { AppSettings } from './storage';
import { calculateNextTargetDate } from './calendar';
import { ensureLunar } from './lunar';
import { plusDays, toISODate, todayLocalDate } from './local-date';
import { useReminderStore } from '../store/useReminderStore';

const FIRED_STORAGE_KEY = 'reminderweb:notified';
const CHECK_INTERVAL_MS = 30_000;

export interface DueNotification {
  key: string;
  title: string;
  body: string;
}

interface ReminderWithConfig extends ReminderItem {
  notificationConfig: ReminderItem['notificationConfig'];
}

function loadFired(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FIRED_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function saveFired(fired: Set<string>): void {
  try {
    window.localStorage.setItem(FIRED_STORAGE_KEY, JSON.stringify([...fired]));
  } catch {
    // localStorage 不可用时忽略（仅本次会话内去重）。
  }
}

function typeLabel(item: ReminderItem): string {
  if (item.type === 'COUNT_UP') return '正数日';
  if (item.type === 'BIRTHDAY') return '生日';
  return '倒数日';
}

/**
 * 计算此刻应当弹出的提醒（同一天内、已到点、未弹过）。
 * 纯逻辑，便于在测试中注入 now。
 */
export function collectDueNotifications(
  reminders: ReminderWithConfig[],
  settings: Pick<AppSettings, 'notificationEnabled'>,
  fired: Set<string>,
  now: Date,
): DueNotification[] {
  if (!settings.notificationEnabled) return [];
  const today = todayLocalDate();
  const result: DueNotification[] = [];
  for (const item of reminders) {
    const config = item.notificationConfig;
    if (!config.isEnabled || !config.useAppNotification) continue;
    let target;
    try {
      target = calculateNextTargetDate(item, today);
    } catch {
      continue;
    }
    if (target === null) continue;
    for (const time of config.notificationTimes) {
      const due = plusDays(target, -time.daysBefore);
      if (due.year !== now.getFullYear() || due.month !== now.getMonth() + 1 || due.day !== now.getDate()) continue;
      const [hh = '0', mm = '0'] = time.time.split(':');
      const dueAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(hh), Number(mm), 0, 0);
      if (now.getTime() < dueAt.getTime()) continue;
      const key = `${item.id}|${toISODate(target)}|${time.time}`;
      if (fired.has(key)) continue;
      result.push({
        key,
        title: item.title,
        body: `${typeLabel(item)} · 还有 ${Math.max(0, Math.round((dueAt.getTime() - now.getTime()) / 86_400_000))} 天`,
      });
    }
  }
  return result;
}

async function showNotification(note: DueNotification): Promise<void> {
  if ('serviceWorker' in navigator) {
    try {
      // 兜底：优先交给 Service Worker 展示。
      const registration = await navigator.serviceWorker.ready;
      if (registration.active !== null) {
        registration.active.postMessage({
          type: 'SHOW_NOTIFICATION',
          title: note.title,
          body: note.body,
          tag: note.key,
        });
        return;
      }
    } catch {
      // 落到下面的直接展示。
    }
  }
  try {
    new Notification(note.title, { body: note.body, tag: note.key, icon: '/pwa-192x192.png' });
  } catch {
    // 忽略：通知不可用时不影响应用。
  }
}

/** 应用级副作用：定时检查到期提醒并弹出。 */
export function useNotificationScheduler(): void {
  const reminders = useReminderStore((state) => state.reminders);
  const settings = useReminderStore((state) => state.settings);
  const loaded = useReminderStore((state) => state.loaded);

  useEffect(() => {
    if (!loaded || !settings.notificationEnabled) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const fired = loadFired();
    let cancelled = false;

    const tick = async () => {
      await ensureLunar();
      if (cancelled) return;
      const now = new Date();
      const due = collectDueNotifications(reminders, settings, fired, now);
      for (const note of due) {
        fired.add(note.key);
        await showNotification(note);
      }
      if (due.length > 0) saveFired(fired);
    };

    void tick();
    const timer = window.setInterval(() => void tick(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loaded, reminders, settings]);
}
