import { describe, expect, it } from 'vitest';
import {
  LOCAL_ONLY_SETTING_KEYS,
  mergeServerSettings,
  normalizeSnapshot,
  syncedSettings,
} from './server-storage';
import { DEFAULT_SETTINGS } from './storage';
import { makeItem } from '../test/factories';

describe('syncedSettings / mergeServerSettings', () => {
  it('可同步字段上传，仅本机字段被剔除', () => {
    const synced = syncedSettings({
      ...DEFAULT_SETTINGS,
      themeOption: 'DARK',
      webdavPassword: 'secret',
      appLockPasswordHash: { v: 2, algo: 'PBKDF2-SHA-256', salt: 's', iterations: 1, hash: 'h' },
    });
    expect(synced.themeOption).toBe('DARK');
    expect('webdavPassword' in synced).toBe(false);
    expect('appLockPasswordHash' in synced).toBe(false);
    expect('webdavEnabled' in synced).toBe(false);
  });

  it('LOCAL_ONLY_SETTING_KEYS 覆盖应用锁与 WebDAV 凭据', () => {
    expect(LOCAL_ONLY_SETTING_KEYS.has('appLockPasswordHash')).toBe(true);
    expect(LOCAL_ONLY_SETTING_KEYS.has('webdavPassword')).toBe(true);
    expect(LOCAL_ONLY_SETTING_KEYS.has('themeOption')).toBe(false);
  });

  it('服务器设置覆盖可同步字段，保留本机专属字段', () => {
    const local = {
      ...DEFAULT_SETTINGS,
      themeOption: 'LIGHT' as const,
      webdavServer: 'https://dav.example.com/dav/',
      appLockEnabled: true,
    };
    const merged = mergeServerSettings(local, { themeOption: 'DARK', webdavServer: 'https://evil.example.com/' });
    expect(merged.themeOption).toBe('DARK');
    expect(merged.webdavServer).toBe('https://dav.example.com/dav/');
    expect(merged.appLockEnabled).toBe(true);
  });

  it('忽略服务器传来的未知/本机专属键', () => {
    const merged = mergeServerSettings({ ...DEFAULT_SETTINGS, webdavPassword: 'keep' }, {
      webdavPassword: 'overwrite',
      unknownKey: 1,
    });
    expect(merged.webdavPassword).toBe('keep');
    expect('unknownKey' in merged).toBe(false);
  });
});

describe('normalizeSnapshot', () => {
  it('归一化提醒/标签并保留 updatedAt', () => {
    const snapshot = normalizeSnapshot({
      revision: 5,
      reminders: [{ id: 1, updatedAt: 100, title: 't', date: '2026-01-01', type: 'ANNUAL' }],
      tags: [{ id: 2, updatedAt: 200, name: '工作', color: '#2196F3', sortOrder: 1 }],
      settings: { value: { themeOption: 'DARK' }, updatedAt: 300 },
      tombstones: [{ id: 9, updatedAt: 400, kind: 'tag' }],
    });
    expect(snapshot.revision).toBe(5);
    expect(snapshot.reminders[0]?.updatedAt).toBe(100);
    expect(snapshot.tags[0]?.updatedAt).toBe(200);
    expect(snapshot.settings).toEqual({ value: { themeOption: 'DARK' }, updatedAt: 300 });
    expect(snapshot.tombstones).toEqual([{ id: 9, updatedAt: 400, kind: 'tag' }]);
  });

  it('坏输入回落为空快照', () => {
    const snapshot = normalizeSnapshot(null);
    expect(snapshot.revision).toBe(0);
    expect(snapshot.reminders).toEqual([]);
    expect(snapshot.settings).toEqual({ value: {}, updatedAt: 0 });
  });

  it('墓碑缺 kind 时按提醒解释，非法项丢弃', () => {
    const snapshot = normalizeSnapshot({
      tombstones: [{ id: 1, updatedAt: 1 }, { id: -1, updatedAt: 1 }, { id: 2 }],
    });
    expect(snapshot.tombstones).toEqual([{ id: 1, updatedAt: 1, kind: 'reminder' }]);
  });

  it('缺失 updatedAt 的条目补 0', () => {
    const snapshot = normalizeSnapshot({ reminders: [{ id: 1, title: 't', date: '2026-01-01' }] });
    expect(snapshot.reminders[0]?.updatedAt).toBe(0);
  });
});

describe('两驱动一致性', () => {
  it('本地 ReminderItem 经服务器快照往返后字段不变', () => {
    const items = [
      makeItem({ id: 1, title: '甲', date: '2026-01-01' }),
      makeItem({ id: 2, title: '乙', date: '2026-02-02', type: 'COUNT_UP' }),
    ];
    const snapshot = normalizeSnapshot({
      revision: 7,
      reminders: items.map((item) => ({ ...item, updatedAt: 1000 })),
      tags: [],
      settings: { value: {}, updatedAt: 0 },
      tombstones: [],
    });
    // 去掉同步元数据后，与本地条目逐字段一致（未知/玻璃字段都不丢）。
    const roundTripped = snapshot.reminders.map((item) => {
      const copy: Record<string, unknown> = { ...item };
      delete copy.updatedAt;
      return copy;
    });
    expect(roundTripped).toEqual(items);
  });

  it('本地模式的设置经 syncedSettings 上传后再合并，仅本机字段不变', () => {
    const local = {
      ...DEFAULT_SETTINGS,
      themeOption: 'DARK' as const,
      webdavPassword: 'local-secret',
      appLockEnabled: true,
    };
    const merged = mergeServerSettings(local, syncedSettings(local));
    expect(merged.themeOption).toBe('DARK');
    expect(merged.webdavPassword).toBe('local-secret');
    expect(merged.appLockEnabled).toBe(true);
  });
});
