/**
 * 后端 API 客户端（需求 §7）。
 *
 * 纯 `fetch` 封装：`credentials: 'same-origin'`、15s 超时、统一 `ApiError` 与中文文案映射，
 * 风格与 `lib/webdav.ts` 一致。该模块不触碰 IndexedDB 与 React，便于单测 mock `fetch`。
 */
import type { ReminderItem, TagItem } from '../types/reminder';

/** 每个请求的超时（毫秒）。 */
export const API_TIMEOUT_MS = 15_000;

/** 构建期后端地址前缀；空字符串表示与页面同源（`/api`）。 */
export function apiBase(): string {
  const configured = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
  const trimmed = configured.trim();
  if (trimmed === '') return '';
  return trimmed.replace(/\/+$/, '');
}

/**
 * 请求凭据策略（M10 §2）：跨域（配置了 `VITE_API_BASE`）时用 `include` 以携带 Cookie，
 * 同源仍用 `same-origin`。
 */
export function requestCredentials(base: string): RequestCredentials {
  return base === '' ? 'same-origin' : 'include';
}

/** 可注入依赖（测试用；生产走默认值）。 */
export interface ApiDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** 覆盖地址前缀，便于测试。 */
  base?: string;
}

export type AuthMode = 'builtin' | 'sso' | 'none';

/** 同步层条目：在 `ReminderItem` / `TagItem` 基础上带 `updatedAt`。 */
export type SyncReminder = ReminderItem & { updatedAt: number };
export type SyncTag = TagItem & { updatedAt: number };

export interface SyncTombstone {
  id: number;
  updatedAt: number;
  kind: 'reminder' | 'tag';
}

export interface SyncSettings {
  value: Record<string, unknown>;
  updatedAt: number;
}

export interface ServerSnapshot {
  revision: number;
  reminders: SyncReminder[];
  tags: SyncTag[];
  settings: SyncSettings;
  tombstones: SyncTombstone[];
  /** 服务端持有的卡片背景图文件名（不含字节）。 */
  imageNames: string[];
}

/** 图片条目（base64 传输，仅整库读取 / 替换用）。 */
export interface WireImage {
  name: string;
  data: string;
}

/** `GET /api/data/full`：快照 + 卡片背景图字节。 */
export interface FullSnapshot extends ServerSnapshot {
  images: WireImage[];
}

export interface HealthInfo {
  ok: boolean;
  revision: number;
  authMode: AuthMode;
  /** M12 §3.2：服务器仍在使用默认/弱口令时为 true（设置页显示提醒条）。 */
  authWarning: boolean;
}

export interface VersionInfo {
  server: string;
  version: string;
  schemaVersion: number;
}

/** 远端备份文件（仅本应用格式，时间倒序）。 */
export interface RemoteBackupFile {
  name: string;
  modifiedAt: number;
}

/** 云端备份条目（M10 §4）：任何本应用备份都可恢复 / 删除。 */
export interface RemoteBackupEntry {
  name: string;
  size: number;
  modifiedAt: number;
}

/** 同步动作（M9 §2.5）。 */
export type SyncAction = 'upload' | 'pull' | 'restore' | 'none';

/** WebDAV 同步状态（不含凭据与远端其它文件信息）。 */
export interface SyncStatus {
  enabled: boolean;
  url: string;
  lastSyncAt: number | null;
  lastUploadAt: number | null;
  lastResult: 'ok' | 'error' | null;
  lastError: string | null;
  pendingChanges: boolean;
  remoteFiles: RemoteBackupFile[];
  /** 下次自动同步的预计时间戳；未启用 / 未排期为 null。 */
  nextSyncAt: number | null;
  /** 最近一次同步合并的条目数。 */
  lastMerged: number;
  /** 最近一次同步 / 备份的动作。 */
  lastAction: SyncAction;
}

/** 同步配置（存服务端，所有设备一致；不含凭据）。 */
export interface SyncConfig {
  enabled: boolean;
  intervalMinutes: number;
  keep: number;
  options: { intervals: number[]; keepRange: [number, number] };
  url: string;
}

/**
 * 服务器级 WebDAV 设置（M12 §3.1 / M13）。
 *
 * 服务器模式下这些值存服务端库、所有设备一致，页面可直接改并立即生效；
 * 环境变量只作首次默认值。口令绝不明文回传，只给 `webdavPasswordSet`。
 */
export interface WebDavConfig {
  /** 是否放行指向回环 / 内网 / 链路本地 / 云元数据的目标（默认关）。 */
  relayAllowPrivate: boolean;
  webdavEnabled: boolean;
  webdavUrl: string;
  webdavUsername: string;
  /** 服务器上是否已设置口令；绝不含口令明文。 */
  webdavPasswordSet: boolean;
  webdavIntervalMinutes: number;
  webdavKeep: number;
}

/** 可提交的 WebDAV 设置补丁；口令缺省 / 空串 = 不改动。 */
export interface WebDavConfigPatch {
  relayAllowPrivate?: boolean;
  webdavEnabled?: boolean;
  webdavUrl?: string;
  webdavUsername?: string;
  webdavPassword?: string;
  webdavIntervalMinutes?: number;
  webdavKeep?: number;
}

/** 恢复结果（M9 §2.2）。 */
export interface SyncRestoreResult {
  applied: { updated: number; added: number; removed: number; rejected: number };
  revision: number;
}

/** 立即备份结果（M9 §2.4）。 */
export interface SyncUploadResult {
  name: string;
  size: number;
  lastUploadAt: number | null;
}

export interface PushPayload {
  baseRevision: number;
  reminders: SyncReminder[];
  tags: SyncTag[];
  settings: SyncSettings;
  tombstones: SyncTombstone[];
}

export interface PushResult extends ServerSnapshot {
  serverRevisionBefore: number;
  baseRevision: number;
  rejected: number;
}

/** 整库替换（`PUT /api/data/replace`）请求体（M11 §2）。 */
export interface ReplacePayload {
  reminders: SyncReminder[];
  tags: SyncTag[];
  settings: SyncSettings;
  images: WireImage[];
}

/** 整库替换返回：服务端写入后的完整快照与计数。 */
export interface ReplaceResult extends ServerSnapshot {
  serverRevisionBefore: number;
  rejected: number;
  counts: { reminders: number; tags: number; images: number };
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'SERVER'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'HTTP'
  | 'INVALID_RESPONSE';

/** API 调用失败；`message` 为面向用户的中文文案。 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;

  constructor(code: ApiErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** 是否为未认证（401 / 需要重新登录）。 */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'UNAUTHORIZED';
}

/** HTTP 状态码 → 中文错误。 */
export function mapHttpStatus(status: number): ApiError {
  if (status === 400) return new ApiError('BAD_REQUEST', '请求内容不正确', status);
  if (status === 401) return new ApiError('UNAUTHORIZED', '登录状态已过期，请重新登录', status);
  if (status === 403) return new ApiError('FORBIDDEN', '没有权限执行该操作', status);
  if (status === 404) return new ApiError('NOT_FOUND', '服务器上找不到该资源', status);
  if (status === 409) return new ApiError('CONFLICT', '数据已在别处更新，请同步后重试', status);
  if (status === 413) return new ApiError('PAYLOAD_TOO_LARGE', '数据过大，服务器拒绝接收', status);
  if (status === 429) return new ApiError('RATE_LIMITED', '操作过于频繁，请稍后再试', status);
  if (status >= 500) return new ApiError('SERVER', `服务器出错（${status}）`, status);
  return new ApiError('HTTP', `服务器返回 ${status}`, status);
}

function mapFetchError(error: unknown): ApiError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError') {
    return new ApiError('TIMEOUT', '连接服务器超时，请检查网络后重试');
  }
  return new ApiError('NETWORK', '连不上服务器，请检查网络');
}

/** 从错误响应体取服务端中文文案（有则优先，否则回落到状态码映射）。 */
async function errorFromResponse(response: Response): Promise<ApiError> {
  const mapped = mapHttpStatus(response.status);
  try {
    const body = (await response.json()) as unknown;
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
      const message = (body as Record<string, unknown>).message;
      if (typeof message === 'string' && message !== '') {
        return new ApiError(mapped.code, message, response.status);
      }
    }
  } catch {
    // 无 JSON 体时保持状态码映射文案。
  }
  return mapped;
}

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  deps: ApiDeps,
): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  if (typeof fetchImpl !== 'function') {
    throw new ApiError('NETWORK', '当前环境不支持网络请求');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? API_TIMEOUT_MS);
  const base = deps.base ?? apiBase();
  try {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      credentials: requestCredentials(base),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw await errorFromResponse(response);
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError('INVALID_RESPONSE', '服务器返回的内容无法解析', response.status);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw mapFetchError(error);
  } finally {
    clearTimeout(timer);
  }
}

/** 探测后端是否可达；失败返回 null（不抛出，用于回落本地模式）。 */
export async function probeHealth(deps: ApiDeps = {}): Promise<HealthInfo | null> {
  try {
    const info = await request<HealthInfo>('GET', '/api/health', undefined, deps);
    if (info !== null && typeof info === 'object' && info.ok === true) {
      const authMode: AuthMode = info.authMode === 'sso' || info.authMode === 'none' ? info.authMode : 'builtin';
      return { ok: true, revision: Number(info.revision) || 0, authMode, authWarning: info.authWarning === true };
    }
    return null;
  } catch {
    return null;
  }
}

export async function login(username: string, password: string, deps: ApiDeps = {}): Promise<{ username: string }> {
  return request<{ username: string }>('POST', '/api/auth/login', { username, password }, deps);
}

export async function logout(deps: ApiDeps = {}): Promise<void> {
  await request<unknown>('POST', '/api/auth/logout', undefined, deps);
}

export async function fetchMe(deps: ApiDeps = {}): Promise<{ username: string; authMode: AuthMode }> {
  return request<{ username: string; authMode: AuthMode }>('GET', '/api/auth/me', undefined, deps);
}

export async function fetchVersion(deps: ApiDeps = {}): Promise<VersionInfo> {
  return request<VersionInfo>('GET', '/api/version', undefined, deps);
}

export async function fetchData(deps: ApiDeps = {}): Promise<ServerSnapshot> {
  return request<ServerSnapshot>('GET', '/api/data', undefined, deps);
}

/** 读取后端 WebDAV 同步状态。 */
export async function fetchSyncStatus(deps: ApiDeps = {}): Promise<SyncStatus> {
  return request<SyncStatus>('GET', '/api/sync/status', undefined, deps);
}

/** 触发后端立即执行一次 WebDAV 同步（进行中/未启用时后端返回 409）。 */
export async function triggerSyncNow(deps: ApiDeps = {}): Promise<SyncStatus> {
  return request<SyncStatus>('POST', '/api/sync/now', undefined, deps);
}

/** 读取同步配置（存服务端，所有设备一致）。 */
export async function fetchSyncConfig(deps: ApiDeps = {}): Promise<SyncConfig> {
  return request<SyncConfig>('GET', '/api/sync/config', undefined, deps);
}

/** 更新同步配置（可只传子集）；返回更新后的完整配置。 */
export async function updateSyncConfig(
  patch: Partial<Pick<SyncConfig, 'enabled' | 'intervalMinutes' | 'keep'>>,
  deps: ApiDeps = {},
): Promise<SyncConfig> {
  return request<SyncConfig>('PUT', '/api/sync/config', patch, deps);
}

/** 读取服务器级 WebDAV 设置（含内网转发开关；不含口令明文）。 */
export async function fetchWebDavConfig(deps: ApiDeps = {}): Promise<WebDavConfig> {
  return request<WebDavConfig>('GET', '/api/webdav/config', undefined, deps);
}

/** 部分更新服务器级 WebDAV 设置；返回更新后的完整设置。 */
export async function updateWebDavConfig(
  patch: WebDavConfigPatch,
  deps: ApiDeps = {},
): Promise<WebDavConfig> {
  return request<WebDavConfig>('PUT', '/api/webdav/config', patch, deps);
}

/** 读取服务器级设置（客户端模式仅用其中的「允许转发到内网地址」）。 */
export async function fetchWebDavRelayConfig(deps: ApiDeps = {}): Promise<WebDavConfig> {
  return fetchWebDavConfig(deps);
}

/** 更新「允许转发到内网地址」开关。 */
export async function updateWebDavRelayConfig(
  relayAllowPrivate: boolean,
  deps: ApiDeps = {},
): Promise<WebDavConfig> {
  return updateWebDavConfig({ relayAllowPrivate }, deps);
}

/** 列出云端备份（时间倒序）。 */
export async function fetchSyncFiles(deps: ApiDeps = {}): Promise<RemoteBackupEntry[]> {
  const body = await request<{ files: RemoteBackupEntry[] }>('GET', '/api/sync/files', undefined, deps);
  return Array.isArray(body.files) ? body.files : [];
}

/** 从指定云端备份恢复（只读，绝不删除远端文件）。 */
export async function restoreSyncFile(name: string, deps: ApiDeps = {}): Promise<SyncRestoreResult> {
  return request<SyncRestoreResult>('POST', '/api/sync/restore', { name }, deps);
}

/** 立即备份：只上传当前数据，不拉取、不合并。 */
export async function uploadSyncNow(deps: ApiDeps = {}): Promise<SyncUploadResult> {
  return request<SyncUploadResult>('POST', '/api/sync/upload', undefined, deps);
}

/** 删除自己上传的云端备份（别人的后端返回 403）。 */
export async function deleteSyncFile(name: string, deps: ApiDeps = {}): Promise<void> {
  await request<unknown>('DELETE', `/api/sync/files/${encodeURIComponent(name)}`, undefined, deps);
}

export async function pushData(payload: PushPayload, deps: ApiDeps = {}): Promise<PushResult> {
  return request<PushResult>('PUT', '/api/data', payload, deps);
}

/** 读取快照 + 卡片背景图字节（迁移 / 服务器模式水合用）。 */
export async function fetchFullData(deps: ApiDeps = {}): Promise<FullSnapshot> {
  return request<FullSnapshot>('GET', '/api/data/full', undefined, deps);
}

/** 整库替换（仅迁移用）：用请求体覆盖服务端全部数据。 */
export async function replaceData(payload: ReplacePayload, deps: ApiDeps = {}): Promise<ReplaceResult> {
  return request<ReplaceResult>('PUT', '/api/data/replace', payload, deps);
}

/** 原始字节请求（图片上传）。 */
async function requestRaw(
  method: string,
  path: string,
  body: Uint8Array,
  contentType: string,
  deps: ApiDeps,
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  if (typeof fetchImpl !== 'function') throw new ApiError('NETWORK', '当前环境不支持网络请求');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? API_TIMEOUT_MS);
  const base = deps.base ?? apiBase();
  try {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      credentials: requestCredentials(base),
      headers: { 'Content-Type': contentType },
      body: body as unknown as BodyInit,
      signal: controller.signal,
    });
    if (!response.ok) throw await errorFromResponse(response);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw mapFetchError(error);
  } finally {
    clearTimeout(timer);
  }
}

/** 上传单张卡片背景图字节（服务器模式水合 / 迁移用）。 */
export async function uploadImage(name: string, bytes: Uint8Array, deps: ApiDeps = {}): Promise<void> {
  await requestRaw('PUT', `/api/images/${encodeURIComponent(name)}`, bytes, 'application/octet-stream', deps);
}

/** 读取单张卡片背景图字节；不存在返回 null。 */
export async function fetchImage(name: string, deps: ApiDeps = {}): Promise<Uint8Array | null> {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  if (typeof fetchImpl !== 'function') return null;
  const base = deps.base ?? apiBase();
  try {
    const response = await fetchImpl(`${base}/api/images/${encodeURIComponent(name)}`, {
      credentials: requestCredentials(base),
    });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** 删除单张卡片背景图。 */
export async function deleteImage(name: string, deps: ApiDeps = {}): Promise<void> {
  await request<unknown>('DELETE', `/api/images/${encodeURIComponent(name)}`, undefined, deps);
}

/** SSO 模式登录跳转地址（沿用仓库既有网关约定）。 */
export function ssoLoginUrl(next: string): string {
  return `/_auth/login?next=${encodeURIComponent(next)}`;
}
