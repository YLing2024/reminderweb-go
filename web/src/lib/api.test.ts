import { describe, expect, it } from 'vitest';
import {
  API_TIMEOUT_MS,
  ApiError,
  fetchData,
  fetchSyncStatus,
  isUnauthorized,
  login,
  mapHttpStatus,
  probeHealth,
  pushData,
  ssoLoginUrl,
  triggerSyncNow,
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

function abortingFetch(): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    })) as unknown as typeof fetch;
}

describe('probeHealth 本地模式回落', () => {
  it('200 时返回健康信息（含默认口令告警标记）', async () => {
    const deps: ApiDeps = {
      fetchImpl: (async () =>
        jsonResponse({ ok: true, revision: 3, authMode: 'builtin', authWarning: true })) as unknown as typeof fetch,
    };
    await expect(probeHealth(deps)).resolves.toEqual({
      ok: true,
      revision: 3,
      authMode: 'builtin',
      authWarning: true,
    });
  });

  it('缺 authWarning 时回落 false', async () => {
    const deps: ApiDeps = {
      fetchImpl: (async () => jsonResponse({ ok: true, revision: 3, authMode: 'builtin' })) as unknown as typeof fetch,
    };
    const info = await probeHealth(deps);
    expect(info?.authWarning).toBe(false);
  });

  it('网络错误时返回 null，不抛出', async () => {
    const deps: ApiDeps = {
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    };
    await expect(probeHealth(deps)).resolves.toBeNull();
  });

  it('非 2xx 时返回 null', async () => {
    const deps: ApiDeps = { fetchImpl: (async () => jsonResponse({ error: 'x' }, 500)) as unknown as typeof fetch };
    await expect(probeHealth(deps)).resolves.toBeNull();
  });

  it('authMode 异常值时回落 builtin', async () => {
    const deps: ApiDeps = {
      fetchImpl: (async () => jsonResponse({ ok: true, revision: 0, authMode: 'nope' })) as unknown as typeof fetch,
    };
    const info = await probeHealth(deps);
    expect(info?.authMode).toBe('builtin');
  });
});

describe('错误映射', () => {
  it('状态码映射为中文 ApiError', () => {
    expect(mapHttpStatus(400).code).toBe('BAD_REQUEST');
    expect(mapHttpStatus(401).code).toBe('UNAUTHORIZED');
    expect(mapHttpStatus(409).code).toBe('CONFLICT');
    expect(mapHttpStatus(409).message).toContain('别处更新');
    expect(mapHttpStatus(413).code).toBe('PAYLOAD_TOO_LARGE');
    expect(mapHttpStatus(429).code).toBe('RATE_LIMITED');
    expect(mapHttpStatus(503).code).toBe('SERVER');
  });

  it('isUnauthorized 只对 401 为真', () => {
    expect(isUnauthorized(new ApiError('UNAUTHORIZED', 'x', 401))).toBe(true);
    expect(isUnauthorized(new ApiError('CONFLICT', 'x', 409))).toBe(false);
    expect(isUnauthorized(new Error('x'))).toBe(false);
  });

  it('401 抛出中文错误', async () => {
    const deps: ApiDeps = { fetchImpl: (async () => jsonResponse({}, 401)) as unknown as typeof fetch };
    await expect(login('a', 'b', deps)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    try {
      await login('a', 'b', deps);
    } catch (error) {
      expect((error as ApiError).message).toContain('重新登录');
    }
  });

  it('超时抛出 TIMEOUT 中文错误', async () => {
    const deps: ApiDeps = { fetchImpl: abortingFetch(), timeoutMs: 10 };
    await expect(login('a', 'b', deps)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('网络错误抛出 NETWORK', async () => {
    const deps: ApiDeps = {
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    };
    await expect(fetchData(deps)).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('坏 JSON 抛出 INVALID_RESPONSE', async () => {
    const bad = {
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad');
      },
      headers: { get: () => null },
    } as unknown as Response;
    const deps: ApiDeps = { fetchImpl: (async () => bad) as unknown as typeof fetch };
    await expect(fetchData(deps)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('请求构造', () => {
  it('pushData 使用 same-origin 凭据并发送 JSON', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const deps: ApiDeps = {
      base: 'https://api.example.com',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return jsonResponse({ revision: 1, reminders: [], tags: [], settings: { value: {}, updatedAt: 0 }, tombstones: [], serverRevisionBefore: 0, baseRevision: 0, rejected: 0 });
      }) as unknown as typeof fetch,
    };
    await pushData(
      { baseRevision: 0, reminders: [], tags: [], settings: { value: {}, updatedAt: 0 }, tombstones: [] },
      deps,
    );
    expect(calls[0]!.url).toBe('https://api.example.com/api/data');
    expect(calls[0]!.init.method).toBe('PUT');
    expect(calls[0]!.init.credentials).toBe('include');
    expect(calls[0]!.init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('同源（未配 VITE_API_BASE）用 same-origin，跨域（配了）用 include', async () => {
    const calls: Array<RequestInit> = [];
    const body = { revision: 1, reminders: [], tags: [], settings: { value: {}, updatedAt: 0 }, tombstones: [], serverRevisionBefore: 0, baseRevision: 0, rejected: 0 };
    const sameOrigin: ApiDeps = {
      fetchImpl: (async (_url: string, init: RequestInit) => {
        calls.push(init);
        return jsonResponse(body);
      }) as unknown as typeof fetch,
    };
    await pushData({ baseRevision: 0, reminders: [], tags: [], settings: { value: {}, updatedAt: 0 }, tombstones: [] }, sameOrigin);
    expect(calls[0]!.credentials).toBe('same-origin');

    const crossOrigin: ApiDeps = { base: 'https://api.example.com', ...sameOrigin };
    await pushData({ baseRevision: 0, reminders: [], tags: [], settings: { value: {}, updatedAt: 0 }, tombstones: [] }, crossOrigin);
    expect(calls[1]!.credentials).toBe('include');
  });

  it('API_TIMEOUT_MS 为 15 秒', () => {
    expect(API_TIMEOUT_MS).toBe(15_000);
  });

  it('ssoLoginUrl 编码 next', () => {
    expect(ssoLoginUrl('/settings?x=1')).toBe('/_auth/login?next=%2Fsettings%3Fx%3D1');
  });
});

describe('WebDAV 同步状态接口', () => {
  const SYNC_STATUS = {
    enabled: true,
    url: 'https://dav.example.com/reminder/',
    lastSyncAt: 1,
    lastUploadAt: 2,
    lastResult: 'ok',
    lastError: null,
    pendingChanges: false,
    remoteFiles: [{ name: 'reminder-backup-20260101-120000.zip', modifiedAt: 3 }],
  };

  it('fetchSyncStatus：GET /api/sync/status 并原样返回状态', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const deps: ApiDeps = {
      base: 'https://api.example.com',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return jsonResponse(SYNC_STATUS);
      }) as unknown as typeof fetch,
    };
    await expect(fetchSyncStatus(deps)).resolves.toEqual(SYNC_STATUS);
    expect(calls[0]!.url).toBe('https://api.example.com/api/sync/status');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('triggerSyncNow：POST /api/sync/now，409 映射为中文冲突', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const deps: ApiDeps = {
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return jsonResponse({ error: 'sync_in_progress' }, 409);
      }) as unknown as typeof fetch,
    };
    await expect(triggerSyncNow(deps)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(calls[0]!.url).toBe('/api/sync/now');
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('triggerSyncNow：成功后返回最新状态', async () => {
    const deps: ApiDeps = { fetchImpl: (async () => jsonResponse({ ...SYNC_STATUS, lastResult: 'ok' })) as unknown as typeof fetch };
    await expect(triggerSyncNow(deps)).resolves.toMatchObject({ enabled: true, lastResult: 'ok' });
  });
});
