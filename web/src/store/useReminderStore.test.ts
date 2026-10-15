/**
 * M10 §1：客户端模式（纯前端）不发起任何 /api 请求。
 *
 * 通过 mock 掉 IndexedDB 存储层，断言 hydrate 后 mode=client 且全局 fetch 从未被调用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/storage')>();
  return {
    ...actual,
    loadPersistedData: async () => ({
      reminders: [],
      tags: [],
      settings: { ...actual.DEFAULT_SETTINGS },
    }),
    savePersistedData: async () => {},
    clearAllData: async () => {},
  };
});

import { makeItem } from '../test/factories';
import { useReminderStore } from './useReminderStore';

describe('客户端模式不发 /api 请求', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv('VITE_APP_MODE', 'client');
    useReminderStore.setState({ mode: 'unknown', loaded: false, reminders: [], tags: [] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('VITE_APP_MODE=client：hydrate 后为客户端模式且 fetch 未被调用', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await useReminderStore.getState().hydrate();

    expect(useReminderStore.getState().mode).toBe('client');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useReminderStore.getState().loaded).toBe(true);
  });

  it('客户端模式增删改与设置变更不发起任何 /api/data 写入（fetch 未被调用）', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await useReminderStore.getState().hydrate();
    expect(useReminderStore.getState().mode).toBe('client');

    const id = await useReminderStore.getState().addReminder(makeItem({ id: 0, title: '甲', date: '2026-01-01' }));
    await useReminderStore.getState().updateReminder(makeItem({ id, title: '甲改', date: '2026-01-02' }));
    await useReminderStore.getState().togglePin(id);
    await useReminderStore.getState().deleteReminder(id);
    await useReminderStore.getState().addTag('工作');
    await useReminderStore.getState().updateSettings({ themeOption: 'DARK' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
