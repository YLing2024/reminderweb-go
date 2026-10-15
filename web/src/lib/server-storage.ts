/**
 * 服务器模式的只读缓存与设置映射（需求 §7）。
 *
 * - 服务器模式下，IndexedDB 仅作**只读离线缓存**（键 `reminderweb:cache`，含 revision）；
 * - 设置里区分「可同步」与「仅本机」：应用锁、WebDAV 凭据、通知权限等只留在本机，
 *   不随服务器设置互相覆盖。
 *
 * 纯函数部分（设置筛选/合并、快照归一化）在这里，便于单测；IndexedDB 读写单独暴露。
 */
import { createStore, del, get, set } from 'idb-keyval';
import type { ReminderItem, TagItem } from '../types/reminder';
import { normalizeReminderList, normalizeTagList } from './normalize';
import type { ServerSnapshot, SyncReminder, SyncSettings, SyncTag, SyncTombstone } from './api';
import type { FullSnapshot, WireImage } from './api';
import { DEFAULT_SETTINGS, type AppSettings } from './storage';

export const SERVER_CACHE_KEY = 'reminderweb:cache';

/** 与 `lib/storage` 使用同一个 IndexedDB 库与对象仓库。 */
const cacheStore = createStore('reminderweb', 'kv');

/**
 * 仅本机的设置键：应用锁、WebDAV 凭据与结果、通知、上次备份等，
 * 不上传服务器，也不被服务器设置覆盖。
 */
export const LOCAL_ONLY_SETTING_KEYS: ReadonlySet<keyof AppSettings> = new Set([
  'notificationEnabled',
  'backupEncryptionEnabled',
  'lastBackupAt',
  'appLockEnabled',
  'appLockPasswordHash',
  'webdavEnabled',
  'webdavServer',
  'webdavUsername',
  'webdavPassword',
  'webdavAutoBackup',
  'webdavKeepCount',
  'webdavLastSuccessAt',
  'webdavLastResult',
]);

/** 提取参与服务器同步的设置字段。 */
export function syncedSettings(settings: AppSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(settings) as Array<keyof AppSettings>) {
    if (LOCAL_ONLY_SETTING_KEYS.has(key)) continue;
    out[key] = settings[key];
  }
  return out;
}

/** 用服务器同步设置覆盖本机可同步字段，保留本机专属字段。 */
export function mergeServerSettings(local: AppSettings, serverValue: Record<string, unknown>): AppSettings {
  const merged: AppSettings = { ...local };
  for (const key of Object.keys(serverValue) as Array<keyof AppSettings>) {
    if (LOCAL_ONLY_SETTING_KEYS.has(key)) continue;
    if (!(key in DEFAULT_SETTINGS)) continue;
    (merged as unknown as Record<string, unknown>)[key] = serverValue[key];
  }
  return merged;
}

function toSyncReminder(raw: ReminderItem): SyncReminder {
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;
  return { ...raw, updatedAt };
}

function toSyncTag(raw: TagItem): SyncTag {
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;
  return { ...raw, updatedAt };
}

function normalizeTombstones(raw: unknown): SyncTombstone[] {
  if (!Array.isArray(raw)) return [];
  const out: SyncTombstone[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = record.id;
    const updatedAt = record.updatedAt;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) continue;
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) continue;
    const kind = record.kind === 'tag' ? 'tag' : 'reminder';
    out.push({ id, updatedAt, kind });
  }
  return out;
}

function normalizeSettings(raw: unknown): SyncSettings {
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as Record<string, unknown>;
    const value = record.value;
    const updatedAt = record.updatedAt;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return {
        value: value as Record<string, unknown>,
        updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0,
      };
    }
  }
  return { value: {}, updatedAt: 0 };
}

/** 把服务器返回的原始 JSON 归一化为类型安全的快照；容错，不抛异常。 */
export function normalizeSnapshot(raw: unknown): ServerSnapshot {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const revision = typeof record.revision === 'number' && Number.isFinite(record.revision) ? record.revision : 0;
  const reminders = normalizeReminderList(record.reminders).map(toSyncReminder);
  const tags = normalizeTagList(record.tags).map(toSyncTag);
  return {
    revision,
    reminders,
    tags,
    settings: normalizeSettings(record.settings),
    tombstones: normalizeTombstones(record.tombstones),
    imageNames: normalizeImageNames(record.imageNames),
  };
}

/** 归一化图片名列表。 */
export function normalizeImageNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && entry !== '') out.push(entry);
  }
  return out;
}

/** 归一化迁移用全量快照（快照 + base64 图片）。 */
export function normalizeFullSnapshot(raw: unknown): FullSnapshot {
  const snapshot = normalizeSnapshot(raw);
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const images: WireImage[] = [];
  if (Array.isArray(record.images)) {
    for (const entry of record.images) {
      if (typeof entry !== 'object' || entry === null) continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.name === 'string' && item.name !== '' && typeof item.data === 'string') {
        images.push({ name: item.name, data: item.data });
      }
    }
  }
  return { ...snapshot, images };
}

export async function loadServerCache(): Promise<ServerSnapshot | null> {
  const raw = await get<unknown>(SERVER_CACHE_KEY, cacheStore);
  if (raw === undefined) return null;
  return normalizeSnapshot(raw);
}

export async function saveServerCache(snapshot: ServerSnapshot): Promise<void> {
  await set(SERVER_CACHE_KEY, snapshot, cacheStore);
}

export async function clearServerCache(): Promise<void> {
  await del(SERVER_CACHE_KEY, cacheStore);
}
