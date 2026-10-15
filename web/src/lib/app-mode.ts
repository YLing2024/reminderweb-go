/**
 * 运行模式判定（M10 §1 / M11 §1）：服务器模式 / 客户端模式（纯前端）。
 *
 * 优先级从高到低：
 *   1. 本机选择：`localStorage['reminderweb:app-mode']`（设置页切换写入，M11 §1）；
 *   2. 运行期配置：静态根下的 `config.json`（`{ "mode": "server" | "client" }`，可选）；
 *   3. 构建期环境变量 `VITE_APP_MODE`（`server` / `client` / `auto`，默认 `auto`）；
 *   4. `auto`：探测 `GET /api/health`，通则服务器模式，不通则客户端模式。
 *
 * 特别约定：显式构建 / 配置为 `client` 且本机未做选择时，视为「纯静态」硬保证，
 * **不再读取 config.json、不探测 /api**，确保客户端模式一条 /api 请求都不发。
 */
import { probeHealth, type HealthInfo } from './api';

export type AppMode = 'server' | 'client' | 'auto';
export type ResolvedMode = 'server' | 'client';
export type ModeSource = 'local' | 'config' | 'env' | 'probe';

/** 本机运行模式选择的 localStorage 键（M11 §1）。 */
export const APP_MODE_STORAGE_KEY = 'reminderweb:app-mode';

export interface ModeDetection {
  mode: ResolvedMode;
  source: ModeSource;
  /** 探测模式下命中的健康信息；其余为 null。 */
  health: HealthInfo | null;
  /**
   * 是否为「纯静态」部署（config.json / VITE_APP_MODE 显式声明 client 且本机未覆盖）：
   * 此时不再探测后端，服务器模式入口应置灰。
   */
  staticOnly: boolean;
}

export interface DetectDeps {
  /** 注入 fetch（测试用）。 */
  fetchImpl?: typeof fetch;
  /** 覆盖构建期模式，默认读 `import.meta.env.VITE_APP_MODE`。 */
  envMode?: AppMode;
  /** 覆盖 config.json 地址，默认静态根下的 `/config.json`。 */
  configUrl?: string;
  /** 覆盖健康探测（测试用）。 */
  probe?: () => Promise<HealthInfo | null>;
  /** 覆盖本机选择（测试用）；不传则读 `localStorage`。 */
  storedMode?: ResolvedMode | null;
  /** 覆盖 localStorage（测试用）。 */
  storage?: Pick<Storage, 'getItem'>;
}

/** 解析构建期模式；未知值一律回落 `auto`。纯函数。 */
export function parseEnvMode(raw: unknown): AppMode {
  if (raw === 'server' || raw === 'client') return raw;
  return 'auto';
}

/** 解析本机模式选择；非法值返回 null。纯函数。 */
export function parseStoredMode(raw: unknown): ResolvedMode | null {
  return raw === 'server' || raw === 'client' ? raw : null;
}

/** 解析 config.json 内容；缺字段 / 非法值返回 null（取不到就跳过）。纯函数。 */
export function parseConfigMode(raw: unknown): ResolvedMode | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const mode = (raw as Record<string, unknown>).mode;
  if (mode === 'server' || mode === 'client') return mode;
  return null;
}

/** 读取本机选择；无法访问 localStorage 或非法时返回 null。 */
export function readStoredAppMode(storage?: Pick<Storage, 'getItem'>): ResolvedMode | null {
  const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  if (target === undefined) return null;
  try {
    return parseStoredMode(target.getItem(APP_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** 写入本机选择（设置页迁移成功后才调用）。 */
export function writeStoredAppMode(mode: ResolvedMode, storage?: Pick<Storage, 'setItem'>): void {
  const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  if (target === undefined) return;
  try {
    target.setItem(APP_MODE_STORAGE_KEY, mode);
  } catch {
    // 浏览器隐私模式可能拒绝写入：模式已在内存生效，忽略持久化失败。
  }
}

/** 纯函数：按优先级合并来源（本机 > config > env > 探测）。 */
export function resolveAppMode(input: {
  fileMode: ResolvedMode | null;
  envMode: AppMode;
  health: HealthInfo | null;
}): ResolvedMode {
  if (input.fileMode !== null) return input.fileMode;
  if (input.envMode === 'server' || input.envMode === 'client') return input.envMode;
  return input.health === null ? 'client' : 'server';
}

/**
 * 纯函数：在 `resolveAppMode` 之上加入本机选择优先级，并标注是否为纯静态部署。
 */
export function resolveDetectedMode(input: {
  storedMode: ResolvedMode | null;
  fileMode: ResolvedMode | null;
  envMode: AppMode;
  health: HealthInfo | null;
}): { mode: ResolvedMode; source: ModeSource; staticOnly: boolean } {
  if (input.storedMode !== null) return { mode: input.storedMode, source: 'local', staticOnly: false };
  if (input.envMode === 'client') return { mode: 'client', source: 'env', staticOnly: true };
  if (input.fileMode !== null) {
    return { mode: input.fileMode, source: 'config', staticOnly: input.fileMode === 'client' };
  }
  if (input.envMode === 'server') return { mode: 'server', source: 'env', staticOnly: false };
  return { mode: input.health === null ? 'client' : 'server', source: 'probe', staticOnly: false };
}

function configUrl(): string {
  const base = (import.meta.env.BASE_URL as string | undefined) ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}config.json`;
}

/** 读取静态根下的 config.json；缺失 / 非法一律返回 null，不抛出。 */
export async function loadConfigMode(deps: { fetchImpl?: typeof fetch; configUrl?: string } = {}): Promise<ResolvedMode | null> {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  if (typeof fetchImpl !== 'function') return null;
  try {
    const response = await fetchImpl(deps.configUrl ?? configUrl(), { cache: 'no-store' });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return parseConfigMode(data);
  } catch {
    return null;
  }
}

/**
 * 运行期判定当前模式。
 * 本机选择最高；显式 `client`（且本机未覆盖）不发任何请求；其余先读 config.json，再按 env / 探测回落。
 */
export async function detectAppMode(deps: DetectDeps = {}): Promise<ModeDetection> {
  const envMode = deps.envMode ?? parseEnvMode(import.meta.env.VITE_APP_MODE);
  const storedMode = deps.storedMode !== undefined ? deps.storedMode : readStoredAppMode(deps.storage);

  // 本机选择优先级最高：直接采用，不读 config、不探测。
  if (storedMode !== null) {
    return { mode: storedMode, source: 'local', health: null, staticOnly: false };
  }
  // 纯静态硬保证：显式 client 构建 → 不读 config、不探测、不发请求。
  if (envMode === 'client') {
    return { mode: 'client', source: 'env', health: null, staticOnly: true };
  }

  const fileMode = await loadConfigMode({ fetchImpl: deps.fetchImpl, configUrl: deps.configUrl });
  if (fileMode !== null) {
    return { mode: fileMode, source: 'config', health: null, staticOnly: fileMode === 'client' };
  }
  if (envMode === 'server') {
    return { mode: 'server', source: 'env', health: null, staticOnly: false };
  }

  const health = deps.probe !== undefined
    ? await deps.probe()
    : await probeHealth(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl });
  return { mode: health === null ? 'client' : 'server', source: 'probe', health, staticOnly: false };
}
