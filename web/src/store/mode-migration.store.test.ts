/**
 * M11 §2 迁移 I/O（store）：服务器→客户端整库覆盖本机、客户端→服务器整库覆盖后端、
 * 迁移后一致性核对、失败不改模式；迁移前自动导出由组件负责，这里验证迁移本身。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64 } from '../lib/base64';
import { DEFAULT_SETTINGS } from '../lib/storage';
import { makeItem } from '../test/factories';

const h = vi.hoisted(() => ({
  imageStore: new Map<string, Blob>(),
  full: { value: null as unknown },
  fullError: { value: null as Error | null },
  replaceResult: { value: null as unknown },
  replaceError: { value: null as Error | null },
  payload: { value: null as unknown },
  saved: { value: null as unknown },
}));

vi.mock('../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/storage')>();
  return {
    ...actual,
    listImageNames: async () => [...h.imageStore.keys()],
    loadImageBlob: async (name: string) => h.imageStore.get(name),
    saveImageBlob: async (name: string, blob: Blob) => {
      h.imageStore.set(name, blob);
    },
    replaceImageBlobs: async (images: Record<string, Blob>) => {
      h.imageStore.clear();
      for (const [name, blob] of Object.entries(images)) h.imageStore.set(name, blob);
    },
    loadPersistedData: async () => ({ reminders: [], tags: [], settings: { ...actual.DEFAULT_SETTINGS } }),
    savePersistedData: async (data: unknown) => {
      h.saved.value = data;
    },
    clearAllData: async () => {
      h.imageStore.clear();
    },
  };
});

vi.mock('../lib/server-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/server-storage')>();
  return { ...actual, saveServerCache: async () => {}, loadServerCache: async () => null };
});

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    fetchFullData: async () => {
      if (h.fullError.value !== null) throw h.fullError.value;
      return h.full.value;
    },
    replaceData: async (payload: unknown) => {
      h.payload.value = payload;
      if (h.replaceError.value !== null) throw h.replaceError.value;
      return h.replaceResult.value;
    },
    pushData: async () => {
      throw new Error('pushData 不应在迁移测试中被调用');
    },
    probeHealth: async () => null,
    fetchData: async () => {
      throw new Error('fetchData 不应在迁移测试中被调用');
    },
  };
});

import { useReminderStore } from './useReminderStore';

function resetStore(): void {
  h.imageStore.clear();
  h.full.value = null;
  h.fullError.value = null;
  h.replaceResult.value = null;
  h.replaceError.value = null;
  h.payload.value = null;
  h.saved.value = null;
  useReminderStore.setState({
    mode: 'unknown',
    reminders: [],
    tags: [],
    settings: { ...DEFAULT_SETTINGS },
    loaded: true,
    serverReachable: false,
    serverImageNames: [],
  });
}

const REMINDER = { ...makeItem({ id: 1, title: '甲', date: '2026-01-01' }), updatedAt: 100 };
const TAG = { id: 1, name: '工作', color: '#2196F3', sortOrder: 1, updatedAt: 100 };

describe('migrateToClient：后端全量覆盖本机', () => {
  beforeEach(resetStore);

  it('覆盖提醒/标签/设置/图片字节，切客户端并核对一致', async () => {
    useReminderStore.setState({ mode: 'server', reminders: [{ ...REMINDER, title: '旧' }] });
    h.full.value = {
      revision: 5,
      reminders: [REMINDER],
      tags: [TAG],
      settings: { value: { themeOption: 'DARK' }, updatedAt: 100 },
      tombstones: [],
      imageNames: ['bg.jpg'],
      images: [{ name: 'bg.jpg', data: bytesToBase64(new Uint8Array([1, 2, 3])) }],
    };

    const outcome = await useReminderStore.getState().migrateToClient();

    const state = useReminderStore.getState();
    expect(state.mode).toBe('client');
    expect(state.reminders.map((item) => item.title)).toEqual(['甲']);
    expect('updatedAt' in state.reminders[0]!).toBe(false);
    expect(state.tags[0]!.name).toBe('工作');
    expect(state.settings.themeOption).toBe('DARK');
    expect([...h.imageStore.keys()]).toEqual(['bg.jpg']);
    expect(h.saved.value).not.toBeNull();
    expect(outcome.direction).toBe('server-to-client');
    expect(outcome.counts).toEqual({ reminders: 1, tags: 1, images: 1 });
    expect(outcome.verification.ok).toBe(true);
  });

  it('后端读取失败时抛错且保持服务器模式与原数据', async () => {
    useReminderStore.setState({ mode: 'server', reminders: [{ ...REMINDER, title: '保留' }] });
    h.fullError.value = new Error('读取服务器数据失败');

    await expect(useReminderStore.getState().migrateToClient()).rejects.toThrow('读取服务器数据失败');
    expect(useReminderStore.getState().mode).toBe('server');
    expect(useReminderStore.getState().reminders[0]!.title).toBe('保留');
  });
});

describe('migrateToServer：本机全量覆盖后端', () => {
  beforeEach(resetStore);

  it('发送带 updatedAt 的条目与图片 base64，切服务器并核对一致', async () => {
    h.imageStore.set('bg.jpg', new Blob([new Uint8Array([9, 9])]));
    useReminderStore.setState({
      mode: 'client',
      reminders: [makeItem({ id: 1, title: '甲', date: '2026-01-01' })],
      tags: [{ id: 1, name: '工作', color: '#2196F3', sortOrder: 1 }],
      settings: { ...DEFAULT_SETTINGS, themeOption: 'DARK' },
    });
    h.replaceResult.value = {
      revision: 6,
      reminders: [REMINDER],
      tags: [TAG],
      settings: { value: { themeOption: 'DARK' }, updatedAt: 1 },
      tombstones: [],
      imageNames: ['bg.jpg'],
      serverRevisionBefore: 5,
      rejected: 0,
      counts: { reminders: 1, tags: 1, images: 1 },
    };

    const outcome = await useReminderStore.getState().migrateToServer();

    const payload = h.payload.value as {
      reminders: Array<{ updatedAt: number }>;
      images: Array<{ name: string; data: string }>;
      settings: { value: Record<string, unknown> };
    };
    expect(typeof payload.reminders[0]!.updatedAt).toBe('number');
    expect(payload.images).toEqual([{ name: 'bg.jpg', data: bytesToBase64(new Uint8Array([9, 9])) }]);
    expect(payload.settings.value.themeOption).toBe('DARK');

    const state = useReminderStore.getState();
    expect(state.mode).toBe('server');
    expect(state.reminders.length).toBe(1);
    expect(outcome.direction).toBe('client-to-server');
    expect(outcome.verification.ok).toBe(true);
  });

  it('后端失败时抛错且保持客户端模式与本地数据', async () => {
    useReminderStore.setState({ mode: 'client', reminders: [makeItem({ id: 1 })] });
    h.replaceError.value = new Error('整库替换失败');

    await expect(useReminderStore.getState().migrateToServer()).rejects.toThrow('整库替换失败');
    expect(useReminderStore.getState().mode).toBe('client');
    expect(useReminderStore.getState().reminders.length).toBe(1);
  });
});
