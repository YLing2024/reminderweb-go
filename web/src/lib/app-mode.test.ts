/**
 * M10 §1 运行模式判定测试：优先级（config.json > VITE_APP_MODE > 探测）
 * 与「客户端模式不发起任何请求」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_MODE_STORAGE_KEY,
  detectAppMode,
  loadConfigMode,
  parseConfigMode,
  parseEnvMode,
  parseStoredMode,
  readStoredAppMode,
  resolveAppMode,
  resolveDetectedMode,
  writeStoredAppMode,
} from './app-mode';
import type { HealthInfo } from './api';

const HEALTH: HealthInfo = { ok: true, revision: 3, authMode: 'builtin', authWarning: false };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('resolveAppMode：优先级 config.json > VITE_APP_MODE > 探测', () => {
  it('config.json 高于 VITE_APP_MODE 与探测', () => {
    expect(resolveAppMode({ fileMode: 'server', envMode: 'client', health: null })).toBe('server');
    expect(resolveAppMode({ fileMode: 'client', envMode: 'server', health: HEALTH })).toBe('client');
  });

  it('无 config 时 VITE_APP_MODE 高于探测', () => {
    expect(resolveAppMode({ fileMode: null, envMode: 'client', health: HEALTH })).toBe('client');
    expect(resolveAppMode({ fileMode: null, envMode: 'server', health: null })).toBe('server');
  });

  it('auto：探测通则服务器模式，不通则客户端模式', () => {
    expect(resolveAppMode({ fileMode: null, envMode: 'auto', health: HEALTH })).toBe('server');
    expect(resolveAppMode({ fileMode: null, envMode: 'auto', health: null })).toBe('client');
  });
});

describe('解析函数', () => {
  it('parseEnvMode：仅 server/client，其余回落 auto', () => {
    expect(parseEnvMode('server')).toBe('server');
    expect(parseEnvMode('client')).toBe('client');
    expect(parseEnvMode('auto')).toBe('auto');
    expect(parseEnvMode(undefined)).toBe('auto');
    expect(parseEnvMode('nope')).toBe('auto');
  });

  it('parseConfigMode：合法值返回，非法/缺失返回 null', () => {
    expect(parseConfigMode({ mode: 'server' })).toBe('server');
    expect(parseConfigMode({ mode: 'client' })).toBe('client');
    expect(parseConfigMode({ mode: 'auto' })).toBeNull();
    expect(parseConfigMode({})).toBeNull();
    expect(parseConfigMode(null)).toBeNull();
    expect(parseConfigMode('server')).toBeNull();
  });
});

describe('loadConfigMode', () => {
  it('读到合法 config.json 返回模式', async () => {
    const mode = await loadConfigMode({
      configUrl: 'https://static.example.com/config.json',
      fetchImpl: (async () => jsonResponse({ mode: 'client' })) as unknown as typeof fetch,
    });
    expect(mode).toBe('client');
  });

  it('404 / 坏 JSON / 网络错误一律返回 null', async () => {
    const notFound = await loadConfigMode({
      fetchImpl: (async () => jsonResponse({ error: 'x' }, 404)) as unknown as typeof fetch,
    });
    expect(notFound).toBeNull();
    const broken = await loadConfigMode({
      fetchImpl: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch,
    });
    expect(broken).toBeNull();
    const network = await loadConfigMode({
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    expect(network).toBeNull();
  });
});

describe('detectAppMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('config.json 指定 server 时直接用，不再探测', async () => {
    const probe = vi.fn(async () => HEALTH);
    const detection = await detectAppMode({
      envMode: 'auto',
      configUrl: 'https://static.example.com/config.json',
      fetchImpl: (async () => jsonResponse({ mode: 'server' })) as unknown as typeof fetch,
      probe,
    });
    expect(detection).toEqual({ mode: 'server', source: 'config', health: null, staticOnly: false });
    expect(probe).not.toHaveBeenCalled();
  });

  it('auto + 无 config：探测通=server，不通=client', async () => {
    const ok = await detectAppMode({
      envMode: 'auto',
      configUrl: '/config.json',
      fetchImpl: (async () => jsonResponse({}, 404)) as unknown as typeof fetch,
      probe: async () => HEALTH,
    });
    expect(ok.mode).toBe('server');
    expect(ok.source).toBe('probe');

    const fail = await detectAppMode({
      envMode: 'auto',
      configUrl: '/config.json',
      fetchImpl: (async () => jsonResponse({}, 404)) as unknown as typeof fetch,
      probe: async () => null,
    });
    expect(fail.mode).toBe('client');
  });

  it('显式 client：不读 config.json、不探测、不调用 fetch', async () => {
    vi.stubEnv('VITE_APP_MODE', 'client');
    const fetchImpl = vi.fn();
    const probe = vi.fn(async () => HEALTH);
    const detection = await detectAppMode({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      probe,
    });
    expect(detection.mode).toBe('client');
    expect(detection.staticOnly).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('M11 §1：本机选择（localStorage）优先级最高', () => {
  it('parseStoredMode：仅 server/client，其余 null', () => {
    expect(parseStoredMode('server')).toBe('server');
    expect(parseStoredMode('client')).toBe('client');
    expect(parseStoredMode('auto')).toBeNull();
    expect(parseStoredMode(null)).toBeNull();
  });

  it('readStoredAppMode / writeStoredAppMode：读写已解析结果', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    expect(readStoredAppMode(storage)).toBeNull();
    writeStoredAppMode('client', storage);
    expect(store.get(APP_MODE_STORAGE_KEY)).toBe('client');
    expect(readStoredAppMode(storage)).toBe('client');
  });

  it('写入 localStorage 后可读回，重载（再次 detect）仍以该模式为准', async () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    writeStoredAppMode('client', storage);
    expect(store.get(APP_MODE_STORAGE_KEY)).toBe('client');
    expect(readStoredAppMode(storage)).toBe('client');

    // 模拟重载：即使构建期 env 是 server，本机选择仍优先。
    const detection = await detectAppMode({ storage, envMode: 'server' });
    expect(detection).toEqual({ mode: 'client', source: 'local', health: null, staticOnly: false });
  });

  it('本机选择高于 config.json / VITE_APP_MODE / 探测', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ mode: 'server' }));
    const probe = vi.fn(async () => HEALTH);
    const detection = await detectAppMode({
      storedMode: 'client',
      envMode: 'server',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      configUrl: 'https://static.example.com/config.json',
      probe,
    });
    expect(detection).toEqual({ mode: 'client', source: 'local', health: null, staticOnly: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();

    const server = await detectAppMode({ storedMode: 'server', envMode: 'client' });
    expect(server).toEqual({ mode: 'server', source: 'local', health: null, staticOnly: false });
  });

  it('config.json client 视为纯静态（staticOnly），env server 非静态', async () => {
    const fromConfig = await detectAppMode({
      storedMode: null,
      envMode: 'auto',
      configUrl: '/config.json',
      fetchImpl: (async () => jsonResponse({ mode: 'client' })) as unknown as typeof fetch,
    });
    expect(fromConfig).toEqual({ mode: 'client', source: 'config', health: null, staticOnly: true });

    const fromEnv = await detectAppMode({ storedMode: null, envMode: 'server' });
    expect(fromEnv).toEqual({ mode: 'server', source: 'env', health: null, staticOnly: false });
  });

  it('resolveDetectedMode：探测结果非静态', () => {
    expect(resolveDetectedMode({ storedMode: null, fileMode: null, envMode: 'auto', health: HEALTH })).toEqual({
      mode: 'server',
      source: 'probe',
      staticOnly: false,
    });
    expect(resolveDetectedMode({ storedMode: null, fileMode: null, envMode: 'auto', health: null })).toEqual({
      mode: 'client',
      source: 'probe',
      staticOnly: false,
    });
  });
});
