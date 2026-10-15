/**
 * WebDAV 客户端（需求 M4 §4 / M12 §1）。
 *
 * 客户端模式的 WebDAV 访问**只走**本应用后端的 `/api/webdav` 转发（M12 §1），
 * 因此浏览器不受跨域限制：目标地址与凭据仅随本次请求发给后端，不落库、不写日志。
 * XML 解析用浏览器原生 `DOMParser`，不引入任何第三方库与运行时依赖。
 *
 * 该模块不触碰 IndexedDB 与 React，只负责「按 URL 说话」，方便单测 mock `fetch`。
 * 所有对外抛出的错误都是 `WebDavError`，其 `message` 已是可直接展示的中文文案。
 */
import { apiBase, requestCredentials } from './api';

/** 每个请求的超时（毫秒）。 */
export const WEBDAV_TIMEOUT_MS = 15_000;
/** 本应用备份文件名前缀，用于过滤远端文件。 */
export const BACKUP_FILE_PREFIX = 'reminder-backup-';
/** 自动备份合并延迟（毫秒）。 */
export const AUTO_BACKUP_DELAY_MS = 60_000;

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>';

export interface WebDavConfig {
  server: string;
  username: string;
  password: string;
}

/** 远端一个备份文件的元信息。 */
export interface WebDavFile {
  /** 文件名（basename）。 */
  name: string;
  /** 字节数，未知为 0。 */
  size: number;
  /** 最后修改时间（epoch 毫秒），未知为 0。 */
  lastModified: number;
}

/** 可注入依赖（测试用；生产走默认值）。 */
export interface WebDavDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** 固定「现在」，便于测试产物确定。 */
  now?: () => Date;
  /** 覆盖后端地址前缀（测试注入）。 */
  apiBase?: string;
}

export type WebDavErrorCode =
  | 'INVALID_URL'
  | 'AUTH'
  | 'NOT_FOUND'
  | 'NOT_WEBDAV'
  | 'NETWORK'
  | 'HTTP'
  | 'INVALID_BACKUP';

/** WebDAV 操作失败；`message` 为面向用户的中文文案。 */
export class WebDavError extends Error {
  readonly code: WebDavErrorCode;
  readonly status: number | undefined;

  constructor(code: WebDavErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'WebDavError';
    this.code = code;
    this.status = status;
  }
}

/** 规范化服务器地址：补协议、补结尾斜杠、去掉 hash；非 http(s) 拒绝。 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new WebDavError('INVALID_URL', '请填写服务器地址');
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new WebDavError('INVALID_URL', '服务器地址格式不正确');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebDavError('INVALID_URL', '服务器地址需以 http 或 https 开头');
  }
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  return url.href;
}

/** 拼接 base 目录与文件名。 */
export function joinUrl(base: string, name: string): string {
  return `${base}${encodeURIComponent(name)}`;
}

function localName(element: Element): string {
  return (element.localName || element.nodeName).toLowerCase();
}

function findFirst(root: Element, name: string): Element | null {
  const children = root.children;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child !== undefined && localName(child) === name) return child;
  }
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    const found = findFirst(child, name);
    if (found !== null) return found;
  }
  return null;
}

function parseXml(xml: string): Document {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    throw new WebDavError('INVALID_BACKUP', '服务器返回的内容无法解析');
  }
  const root = doc.documentElement;
  if (root === null || root === undefined || localName(root) === 'parsererror') {
    throw new WebDavError('INVALID_BACKUP', '服务器返回的内容无法解析');
  }
  return doc;
}

/** 从 href 取 basename，去掉查询串并解码。 */
export function fileNameFromHref(href: string): string {
  const path = href.split('?')[0]!.split('#')[0]!;
  const withoutSlash = path.endsWith('/') ? path.slice(0, -1) : path;
  const last = withoutSlash.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** 是否为本应用产生的备份文件名。 */
export function isBackupName(name: string): boolean {
  return name.startsWith(BACKUP_FILE_PREFIX) && name.toLowerCase().endsWith('.zip');
}

/** 解析 PROPFIND 响应：只留本应用 `*.zip`，按时间倒序（未知时间排后）。 */
export function parsePropfind(xml: string): WebDavFile[] {
  const doc = parseXml(xml);
  const all = Array.from(doc.getElementsByTagName('*'));
  const byName = new Map<string, WebDavFile>();
  for (const element of all) {
    if (localName(element) !== 'response') continue;
    const hrefEl = findFirst(element, 'href');
    if (hrefEl === null) continue;
    const name = fileNameFromHref(hrefEl.textContent ?? '');
    if (!isBackupName(name)) continue;
    const sizeText = findFirst(element, 'getcontentlength')?.textContent ?? '';
    const modifiedText = findFirst(element, 'getlastmodified')?.textContent ?? '';
    const size = Number.parseInt(sizeText.trim(), 10);
    const lastModified = Date.parse(modifiedText.trim());
    byName.set(name, {
      name,
      size: Number.isFinite(size) ? size : 0,
      lastModified: Number.isFinite(lastModified) ? lastModified : 0,
    });
  }
  return [...byName.values()].sort(
    (a, b) => b.lastModified - a.lastModified || b.name.localeCompare(a.name),
  );
}

/** HTTP 状态码 → 中文错误。 */
export function mapHttpError(status: number): WebDavError {
  if (status === 401 || status === 403) {
    return new WebDavError('AUTH', '用户名或密码不正确，或该账号无权访问此目录', status);
  }
  if (status === 404) {
    return new WebDavError('NOT_FOUND', '地址不对，服务器上找不到该路径', status);
  }
  if (status === 405) {
    return new WebDavError('NOT_WEBDAV', '该地址不像 WebDAV 服务（服务器拒绝了 PROPFIND）', status);
  }
  return new WebDavError('HTTP', `服务器返回 ${status}`, status);
}

/**
 * fetch 层异常 → 中文错误。
 *
 * 客户端模式一律经本应用后端转发，因此浏览器的跨域限制不适用；
 * 这里只可能是「连不上本应用服务器」，给出可直接照做的提示，而不是 `TypeError: Failed to fetch`。
 */
export function mapFetchError(error: unknown): WebDavError {
  if (error instanceof WebDavError) return error;
  return new WebDavError('NETWORK', '客户端模式的 WebDAV 备份需要本应用服务器在运行（用于转发请求）。');
}

async function send(
  config: WebDavConfig,
  method: string,
  url: string,
  deps: WebDavDeps,
  body?: BodyInit | null,
  headers?: Record<string, string>,
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  if (typeof fetchImpl !== 'function') {
    throw new WebDavError('NETWORK', '客户端模式的 WebDAV 备份需要本应用服务器在运行（用于转发请求）。');
  }
  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? WEBDAV_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // 一律经本应用后端转发：目标地址与凭据仅随本次请求发给后端，不落库、不写日志。
    const base = deps.apiBase ?? apiBase();
    const response = await fetchImpl(`${base}/api/webdav`, {
      method,
      credentials: requestCredentials(base),
      headers: {
        'X-Dav-Url': url,
        'X-Dav-User': config.username,
        'X-Dav-Password': config.password,
        ...headers,
      },
      body: body ?? null,
      signal: controller.signal,
    });
    // 纯静态托管（SPA 回退）会把未知路径回 `index.html`：2xx + HTML 说明这不是后端转发接口，
    // 给出明确提示，而不是「服务器返回的内容无法解析」。
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (response.ok && contentType.toLowerCase().includes('text/html')) {
      throw new WebDavError('NETWORK', '客户端模式的 WebDAV 备份需要本应用服务器在运行（用于转发请求）。');
    }
    return response;
  } catch (error) {
    throw mapFetchError(error);
  } finally {
    clearTimeout(timer);
  }
}

function assertOk(response: Response): void {
  if (!response.ok) throw mapHttpError(response.status);
}

/** 测试连接：PROPFIND Depth: 0，验证地址与凭据。 */
export async function testConnection(config: WebDavConfig, deps: WebDavDeps = {}): Promise<void> {
  const base = normalizeBaseUrl(config.server);
  const response = await send(config, 'PROPFIND', base, deps, PROPFIND_BODY, {
    'Content-Type': 'application/xml; charset=utf-8',
    Depth: '0',
  });
  assertOk(response);
}

/** 列目录：PROPFIND Depth: 1，返回本应用备份文件（时间倒序）。 */
export async function listBackups(config: WebDavConfig, deps: WebDavDeps = {}): Promise<WebDavFile[]> {
  const base = normalizeBaseUrl(config.server);
  const response = await send(config, 'PROPFIND', base, deps, PROPFIND_BODY, {
    'Content-Type': 'application/xml; charset=utf-8',
    Depth: '1',
  });
  assertOk(response);
  return parsePropfind(await response.text());
}

async function ensureCollection(config: WebDavConfig, base: string, deps: WebDavDeps): Promise<void> {
  const response = await send(config, 'MKCOL', base, deps);
  // 目录已存在：MKCOL 按 RFC 4918 返回 405（部分服务器返回 301）。
  if (response.status === 405 || response.status === 301) return;
  assertOk(response);
}

/** 上传备份：先 MKCOL 建目录（已存在忽略），再 PUT。 */
export async function uploadBackup(
  config: WebDavConfig,
  bytes: Uint8Array,
  fileName: string,
  deps: WebDavDeps = {},
): Promise<void> {
  const base = normalizeBaseUrl(config.server);
  const payload = new Blob([bytes as BlobPart], { type: 'application/zip' });
  await ensureCollection(config, base, deps);
  const response = await send(config, 'PUT', joinUrl(base, fileName), deps, payload, {
    'Content-Type': 'application/zip',
  });
  assertOk(response);
}

/** 下载备份字节。 */
export async function downloadBackup(
  config: WebDavConfig,
  fileName: string,
  deps: WebDavDeps = {},
): Promise<Uint8Array> {
  const base = normalizeBaseUrl(config.server);
  const response = await send(config, 'GET', joinUrl(base, fileName), deps);
  assertOk(response);
  return new Uint8Array(await response.arrayBuffer());
}

/** 删除备份（仅用于保留份数清理）。 */
export async function deleteBackup(
  config: WebDavConfig,
  fileName: string,
  deps: WebDavDeps = {},
): Promise<void> {
  const base = normalizeBaseUrl(config.server);
  const response = await send(config, 'DELETE', joinUrl(base, fileName), deps);
  assertOk(response);
}

/** 保留份数裁剪：保留最新的 keep 份（仅本应用文件），删除其余，返回删除数量。 */
export async function pruneBackups(
  config: WebDavConfig,
  files: WebDavFile[],
  keep: number,
  deps: WebDavDeps = {},
): Promise<number> {
  const limit = Math.max(1, Math.min(100, Math.floor(keep) || 1));
  const ordered = [...files]
    .filter((file) => isBackupName(file.name))
    .sort((a, b) => b.lastModified - a.lastModified || b.name.localeCompare(a.name));
  let deleted = 0;
  for (const file of ordered.slice(limit)) {
    await deleteBackup(config, file.name, deps);
    deleted += 1;
  }
  return deleted;
}

export interface ThrottledRunner {
  /** 记一次变动；窗口内多次调用只会在静默 delayMs 后触发一次。 */
  schedule: () => void;
  /** 立即执行（若已有待触发的会先取消）。 */
  flush: () => Promise<void>;
  /** 取消待触发的执行。 */
  cancel: () => void;
}

/** 自动备份节流器：连续变动合并为一次延迟执行。 */
export function createThrottledRunner(task: () => Promise<void>, delayMs = AUTO_BACKUP_DELAY_MS): ThrottledRunner {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  async function run(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await task();
    } finally {
      running = false;
    }
  }

  return {
    schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    },
    async flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await run();
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
