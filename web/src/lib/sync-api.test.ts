import { describe, expect, it } from 'vitest';
import {
  deleteSyncFile,
  fetchSyncConfig,
  fetchSyncFiles,
  restoreSyncFile,
  updateSyncConfig,
  uploadSyncNow,
  type ApiDeps,
} from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

interface Call {
  url: string;
  init: RequestInit;
}

function recordingFetch(body: unknown, status = 200): { deps: ApiDeps; calls: Call[] } {
  const calls: Call[] = [];
  const deps: ApiDeps = {
    base: 'https://api.example.com',
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(body, status);
    }) as unknown as typeof fetch,
  };
  return { deps, calls };
}

const CONFIG = {
  enabled: true,
  intervalMinutes: 10,
  keep: 10,
  options: { intervals: [5, 10, 30, 60], keepRange: [1, 50] },
  url: 'https://dav.example.com/reminder/',
};

describe('同步配置接口', () => {
  it('fetchSyncConfig：GET /api/sync/config', async () => {
    const { deps, calls } = recordingFetch(CONFIG);
    await expect(fetchSyncConfig(deps)).resolves.toEqual(CONFIG);
    expect(calls[0]!.url).toBe('https://api.example.com/api/sync/config');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('updateSyncConfig：PUT 子集并原样返回新配置', async () => {
    const { deps, calls } = recordingFetch({ ...CONFIG, intervalMinutes: 30 });
    const result = await updateSyncConfig({ intervalMinutes: 30 }, deps);
    expect(result.intervalMinutes).toBe(30);
    expect(calls[0]!.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ intervalMinutes: 30 });
  });

  it('非法配置 400：展示服务端中文文案', async () => {
    const { deps } = recordingFetch({ error: 'invalid_config', message: '同步间隔只能选择 5 / 10 / 30 / 60 分钟' }, 400);
    await expect(updateSyncConfig({ intervalMinutes: 7 }, deps)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '同步间隔只能选择 5 / 10 / 30 / 60 分钟',
    });
  });
});

describe('云端备份接口', () => {
  it('fetchSyncFiles：GET /api/sync/files 返回列表', async () => {
    const files = [{ name: 'reminder-backup-20260101-120000.zip', size: 123, modifiedAt: 1 }];
    const { deps, calls } = recordingFetch({ files });
    await expect(fetchSyncFiles(deps)).resolves.toEqual(files);
    expect(calls[0]!.url).toBe('https://api.example.com/api/sync/files');
  });

  it('fetchSyncFiles：响应缺失 files 时回落空数组', async () => {
    const { deps } = recordingFetch({});
    await expect(fetchSyncFiles(deps)).resolves.toEqual([]);
  });

  it('restoreSyncFile：POST /api/sync/restore 带 name', async () => {
    const applied = { applied: { updated: 1, added: 2, removed: 0, rejected: 0 }, revision: 5 };
    const { deps, calls } = recordingFetch(applied);
    await expect(restoreSyncFile('reminder-backup-20260101-120000.zip', deps)).resolves.toEqual(applied);
    expect(calls[0]!.url).toBe('https://api.example.com/api/sync/restore');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ name: 'reminder-backup-20260101-120000.zip' });
  });

  it('restoreSyncFile：坏包 400 中文文案', async () => {
    const { deps } = recordingFetch({ error: 'invalid_backup', message: '该备份无法解析：备份包已损坏，无法解压。' }, 400);
    await expect(restoreSyncFile('reminder-backup-20260101-120000.zip', deps)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '该备份无法解析：备份包已损坏，无法解压。',
    });
  });

  it('uploadSyncNow：POST /api/sync/upload', async () => {
    const outcome = { name: 'reminder-backup-20260101-120000.zip', size: 9, lastUploadAt: 1 };
    const { deps, calls } = recordingFetch(outcome);
    await expect(uploadSyncNow(deps)).resolves.toEqual(outcome);
    expect(calls[0]!.url).toBe('https://api.example.com/api/sync/upload');
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('deleteSyncFile：DELETE 且文件名做 URL 编码', async () => {
    const { deps, calls } = recordingFetch({ ok: true });
    await deleteSyncFile('reminder-backup-20260101-120000.zip', deps);
    expect(calls[0]!.url).toBe('https://api.example.com/api/sync/files/reminder-backup-20260101-120000.zip');
    expect(calls[0]!.init.method).toBe('DELETE');
  });

  it('deleteSyncFile：服务端 403 透传中文文案（映射为 FORBIDDEN）', async () => {
    const { deps } = recordingFetch({ error: 'forbidden', message: '没有权限执行该操作' }, 403);
    await expect(deleteSyncFile('reminder-backup-20260101-120000.zip', deps)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: '没有权限执行该操作',
    });
  });
});
