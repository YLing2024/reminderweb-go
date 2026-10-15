/**
 * M12 §1 客户端模式 WebDAV 一律经后端 `/api/webdav` 转发。
 */
import { describe, expect, it } from 'vitest';
import { listBackups, mapFetchError, testConnection, uploadBackup } from './webdav';

const CONFIG = { server: 'https://dav.example.com/dav/', username: 'davuser', password: '密码' };

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stubFetch(status = 207, body = ''): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('经后端转发传输', () => {
  it('请求 /api/webdav 并携带 X-Dav-* 头，不含 Authorization', async () => {
    const { fetchImpl, calls } = stubFetch(
      207,
      '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/reminder-backup-20260101-120000.zip</d:href><d:propstat><d:prop><d:getcontentlength>3</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>',
    );
    const files = await listBackups(CONFIG, { fetchImpl });
    expect(files.map((file) => file.name)).toEqual(['reminder-backup-20260101-120000.zip']);
    const call = calls[0]!;
    expect(call.url).toBe('/api/webdav');
    expect(call.method).toBe('PROPFIND');
    expect(call.headers['X-Dav-Url']).toBe('https://dav.example.com/dav/');
    expect(call.headers['X-Dav-User']).toBe('davuser');
    expect(call.headers['X-Dav-Password']).toBe('密码');
    expect(call.headers.Depth).toBe('1');
    expect(call.headers.Authorization).toBeUndefined();
  });

  it('测试连接同样经转发（不直接请求目标地址）', async () => {
    const { fetchImpl, calls } = stubFetch(207);
    await testConnection(CONFIG, { fetchImpl });
    expect(calls[0]!.url).toBe('/api/webdav');
    expect(calls[0]!.headers['X-Dav-Url']).toBe('https://dav.example.com/dav/');
  });

  it('上传经代理：PUT 请求体与 Content-Type 原样透传', async () => {
    const { fetchImpl, calls } = stubFetch(201);
    await uploadBackup(CONFIG, new Uint8Array([1, 2, 3]), 'reminder-backup-20260101-120000.zip', {
      fetchImpl,
    });
    const put = calls.find((call) => call.method === 'PUT')!;
    expect(put.url).toBe('/api/webdav');
    expect(put.headers['Content-Type']).toBe('application/zip');
    expect(put.headers['X-Dav-Url']).toBe('https://dav.example.com/dav/reminder-backup-20260101-120000.zip');
    expect(put.body).toBeInstanceOf(Blob);
  });

  it('apiBase 指定后端地址时请求落到该前缀', async () => {
    const { fetchImpl, calls } = stubFetch(207);
    await testConnection(CONFIG, { fetchImpl, apiBase: 'https://app.example.com' });
    expect(calls[0]!.url).toBe('https://app.example.com/api/webdav');
  });
});

describe('人话报错', () => {
  it('后端不可达：给出需要本应用服务器在运行的提示，而非 TypeError', () => {
    const error = mapFetchError(new TypeError('Failed to fetch'));
    expect(error.code).toBe('NETWORK');
    expect(error.message).toContain('本应用服务器在运行');
    expect(error.message).not.toContain('Failed to fetch');
  });

  it('纯静态托管 SPA 回退（2xx + HTML）同样提示需要后端，而非解析错误', async () => {
    const fetchImpl = (async () =>
      new Response('<html>index</html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })) as unknown as typeof fetch;
    await expect(testConnection(CONFIG, { fetchImpl })).rejects.toMatchObject({
      code: 'NETWORK',
      message: expect.stringContaining('本应用服务器在运行'),
    });
  });
});
