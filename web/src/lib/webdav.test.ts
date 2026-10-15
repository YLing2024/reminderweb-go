import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  WebDavError,
  createThrottledRunner,
  mapFetchError,
  mapHttpError,
  normalizeBaseUrl,
  parsePropfind,
  pruneBackups,
  testConnection,
  listBackups,
  type WebDavFile,
} from './webdav';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function propfindXml(
  entries: Array<{ href: string; size?: number; modified?: string }>,
  prefix = 'd:',
): string {
  const responses = entries
    .map((entry) => {
      const size = entry.size === undefined ? '' : `<${prefix}getcontentlength>${entry.size}</${prefix}getcontentlength>`;
      const modified = entry.modified === undefined ? '' : `<${prefix}getlastmodified>${entry.modified}</${prefix}getlastmodified>`;
      return `<${prefix}response><${prefix}href>${entry.href}</${prefix}href><${prefix}propstat><${prefix}prop>${size}${modified}</${prefix}prop></${prefix}propstat></${prefix}response>`;
    })
    .join('');
  const namespace = prefix === '' ? 'xmlns="DAV:"' : `xmlns:${prefix.slice(0, -1)}="DAV:"`;
  return `<?xml version="1.0" encoding="utf-8"?><${prefix}multistatus ${namespace}>${responses}</${prefix}multistatus>`;
}

describe('normalizeBaseUrl URL 规范化', () => {
  it('缺协议补 https，缺尾斜杠补 /', () => {
    expect(normalizeBaseUrl('dav.example.com/dav')).toBe('https://dav.example.com/dav/');
  });

  it('已带尾斜杠保持稳定（幂等）', () => {
    const once = normalizeBaseUrl('https://dav.example.com/dav/');
    expect(once).toBe('https://dav.example.com/dav/');
    expect(normalizeBaseUrl(once)).toBe(once);
  });

  it('保留 http 与端口，仅补尾斜杠', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/');
  });

  it('空地址与非 http(s) 协议报错', () => {
    expect(() => normalizeBaseUrl('   ')).toThrow(/服务器地址/);
    expect(() => normalizeBaseUrl('ftp://dav.example.com/')).toThrow(WebDavError);
  });
});

describe('parsePropfind PROPFIND 解析', () => {
  it('空目录（只有集合自身）返回空数组', () => {
    const xml = propfindXml([{ href: '/dav/' }]);
    expect(parsePropfind(xml)).toEqual([]);
  });

  it('过滤无关文件与非 zip，只留本应用备份', () => {
    const xml = propfindXml([
      { href: '/dav/' },
      { href: '/dav/notes.txt' },
      { href: '/dav/other-20260101.zip' },
      { href: '/dav/reminder-backup-20260101-120000.tar' },
      { href: '/dav/reminder-backup-20260101-120000.zip', size: 10, modified: 'Wed, 01 Jan 2026 12:00:00 GMT' },
    ]);
    const files = parsePropfind(xml);
    expect(files.map((file) => file.name)).toEqual(['reminder-backup-20260101-120000.zip']);
    expect(files[0]!.size).toBe(10);
  });

  it('多个备份按最后修改时间倒序', () => {
    const xml = propfindXml([
      { href: '/dav/reminder-backup-20260101-120000.zip', size: 1, modified: 'Thu, 01 Jan 2026 12:00:00 GMT' },
      { href: '/dav/reminder-backup-20260301-120000.zip', size: 3, modified: 'Sun, 01 Mar 2026 12:00:00 GMT' },
      { href: '/dav/reminder-backup-20260201-120000.zip', size: 2, modified: 'Sun, 01 Feb 2026 12:00:00 GMT' },
    ]);
    const names = parsePropfind(xml).map((file) => file.name);
    expect(names).toEqual([
      'reminder-backup-20260301-120000.zip',
      'reminder-backup-20260201-120000.zip',
      'reminder-backup-20260101-120000.zip',
    ]);
  });

  it('默认命名空间（无前缀）与完整 URL href 同样解析', () => {
    const xml = propfindXml(
      [{ href: 'https://dav.example.com/dav/reminder-backup-20260101-120000.zip', size: 5, modified: 'Thu, 01 Jan 2026 12:00:00 GMT' }],
      '',
    );
    const files = parsePropfind(xml);
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe('reminder-backup-20260101-120000.zip');
    expect(files[0]!.size).toBe(5);
  });

  it('非法 XML 报可读错误', () => {
    expect(() => parsePropfind('<not-xml')).toThrow(WebDavError);
  });
});

describe('错误码到中文文案映射', () => {
  it('HTTP 状态码', () => {
    expect(mapHttpError(401).code).toBe('AUTH');
    expect(mapHttpError(403).code).toBe('AUTH');
    expect(mapHttpError(401).message).toContain('用户名或密码');
    expect(mapHttpError(404).code).toBe('NOT_FOUND');
    expect(mapHttpError(405).code).toBe('NOT_WEBDAV');
    expect(mapHttpError(500).message).toBe('服务器返回 500');
  });

  it('网络失败统一映射为「需要本应用服务器在运行」，不暴露 TypeError 文案', () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    expect(mapFetchError(abortError).code).toBe('NETWORK');

    const failed = new TypeError('Failed to fetch');
    const mapped = mapFetchError(failed);
    expect(mapped.code).toBe('NETWORK');
    expect(mapped.message).toContain('本应用服务器在运行');
    expect(mapped.message).not.toContain('Failed to fetch');
  });
});

function makeResponse(status: number, body = ''): Response {
  const nullBody = status === 204 || status === 304;
  return new Response(nullBody ? null : body, { status });
}

describe('客户端请求与错误映射', () => {
  it('PROPFIND 405 映射为「不像 WebDAV 服务」', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(405)) as unknown as typeof fetch;
    await expect(
      testConnection({ server: 'https://dav.example.com/dav/', username: 'davuser', password: 'secret' }, { fetchImpl }),
    ).rejects.toMatchObject({ code: 'NOT_WEBDAV' });
  });

  it('listBackups 401 映射为认证错误', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(401)) as unknown as typeof fetch;
    await expect(
      listBackups({ server: 'https://dav.example.com/dav/', username: 'davuser', password: 'bad' }, { fetchImpl }),
    ).rejects.toMatchObject({ code: 'AUTH' });
  });

  it('后端不可达（TypeError: Failed to fetch）时给出指向服务器在运行的提示', async () => {
    const fetchImpl = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    await expect(
      testConnection(
        { server: 'https://dav.example.com/dav/', username: 'davuser', password: 'secret' },
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ code: 'NETWORK', message: expect.stringContaining('本应用服务器在运行') });
  });

  it('请求超时中止并映射为网络错误', async () => {
    vi.useFakeTimers();
    const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })) as unknown as typeof fetch;
    const promise = testConnection(
      { server: 'https://dav.example.com/dav/', username: 'davuser', password: 'secret' },
      { fetchImpl, timeoutMs: 15_000 },
    );
    const assertion = expect(promise).rejects.toMatchObject({ code: 'NETWORK' });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    vi.useRealTimers();
  });
});

describe('pruneBackups 保留份数裁剪', () => {
  const files = (count: number): WebDavFile[] =>
    Array.from({ length: count }, (_, index) => ({
      name: `reminder-backup-2026010${index + 1}-120000.zip`,
      size: index + 1,
      lastModified: Date.UTC(2026, 0, index + 1),
    }));

  it('多于 N 份时删除最旧的，只 DELETE 本应用文件', async () => {
    const deleted: string[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      deleted.push(headers['X-Dav-Url'] ?? '');
      return makeResponse(204);
    }) as unknown as typeof fetch;
    const config = { server: 'https://dav.example.com/dav/', username: 'davuser', password: 'secret' };
    const count = await pruneBackups(config, files(4), 2, { fetchImpl });
    expect(count).toBe(2);
    expect(deleted).toHaveLength(2);
    // 删的是最旧两份（1 日、2 日），最新两份保留。
    expect(deleted.some((url) => url.includes('reminder-backup-20260101-120000.zip'))).toBe(true);
    expect(deleted.some((url) => url.includes('reminder-backup-20260102-120000.zip'))).toBe(true);
    expect(deleted.some((url) => url.includes('reminder-backup-20260103-120000.zip'))).toBe(false);
    expect(deleted.some((url) => url.includes('reminder-backup-20260104-120000.zip'))).toBe(false);
  });

  it('不超过 N 份时不删除；非本应用文件不会被删', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(204)) as unknown as typeof fetch;
    const config = { server: 'https://dav.example.com/dav/', username: 'davuser', password: 'secret' };
    expect(await pruneBackups(config, files(2), 5, { fetchImpl })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();

    const mixed: WebDavFile[] = [
      ...files(2),
      { name: 'someone-else.zip', size: 1, lastModified: 1 },
    ];
    const fetchMock = vi.fn(async () => makeResponse(204)) as unknown as typeof fetch;
    expect(await pruneBackups(config, mixed, 1, { fetchImpl: fetchMock })).toBe(1);
    const firstCall = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const headers = (firstCall[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers['X-Dav-Url']).toContain('reminder-backup-20260101-120000.zip');
  });
});

describe('createThrottledRunner 自动备份节流', () => {
  it('连续变动只触发一次，静默满窗口后执行', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const runner = createThrottledRunner(async () => {
      calls += 1;
    }, 60_000);
    runner.schedule();
    runner.schedule();
    runner.schedule();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(1);
    runner.schedule();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(2);
    vi.useRealTimers();
  });
});
