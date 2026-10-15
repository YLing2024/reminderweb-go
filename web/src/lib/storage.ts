/**
 * IndexedDB 持久化（idb-keyval）。
 *
 * 存放约定（需求 §3）：
 * - 结构化数据一份存 key `reminderweb:data`，其中包含 `settings`（`AppSettings`）；
 * - 图片按文件名存 `reminderweb:image:<name>`，与安卓 zip 内 `images/<name>` 引用一致；
 * - 字体按文件名存 `reminderweb:font:<name>`。
 *
 * WebDAV 云备份凭据不单独建 key：作为 `AppSettings` 的 `webdavServer /
 * webdavUsername / webdavPassword` 字段，随结构化数据存在 `reminderweb:data` 这一键下。
 * 密码只进不出：不写日志、不进导出备份（`toBackupData` 不写 webDav 字段，M12 §2）。
 *
 * 应用锁密码同样只存本地：`AppSettings.appLockPasswordHash` 为 v2 PBKDF2 凭据对象
 *   `{ v: 2, algo: 'PBKDF2-SHA-256', salt: <base64>, iterations: 210000, hash: <base64> }`；
 * 旧版遗留的 v1 十六进制摘要字符串按原样读入，由解锁流程校验成功后升级为 v2。
 * 无论 v1/v2，密码、盐、哈希都不写日志、不进导出备份。
 */
import { createStore, del, get, keys, set, clear } from 'idb-keyval';
import type { ReminderItem, TagItem } from '../types/reminder';
import type { StoredAppLock } from './app-lock';
import { isAppLockCredential } from './app-lock';
import { normalizeReminderList, normalizeTagList } from './normalize';

export const DATA_KEY = 'reminderweb:data';
export const IMAGE_KEY_PREFIX = 'reminderweb:image:';
export const FONT_KEY_PREFIX = 'reminderweb:font:';

/** Web 端本地设置（与安卓 Settings 对齐的子集，M2 起使用）。 */
export interface AppSettings {
  themeOption: 'SYSTEM' | 'LIGHT' | 'DARK';
  pureBlackEnabled: boolean;
  cardColoringEnabled: boolean;
  homeCategoryEnabled: boolean;
  defaultPage: 'COUNTDOWN' | 'COUNTUP' | 'BIRTHDAY';
  viewMode: string;
  scrollBehavior: string;
  dynamicColorEnabled: boolean;
  themeColorPalette: string;
  customColorSeed: number | null;
  /** 提醒：是否启用应用内通知（Web Notification 权限）。 */
  notificationEnabled: boolean;
  /** 提醒：默认提前天数。 */
  defaultAdvanceDays: number;
  /** 提醒：提醒方式（应用内通知 / 导出 .ics）。 */
  reminderMethod: 'APP_NOTIFICATION' | 'ICS';
  /** 数据：备份提醒开关。 */
  backupReminderEnabled: boolean;
  /** 数据：导出备份时是否启用「加密（兼容安卓）」。 */
  backupEncryptionEnabled: boolean;
  /** 数据：上次备份时间（epoch 毫秒），从未备份为 null。 */
  lastBackupAt: number | null;
  /** 安全：应用锁开关。 */
  appLockEnabled: boolean;
  /**
   * 安全：应用锁凭据。v2 为 PBKDF2-SHA-256 加盐凭据对象；
   * v1 为旧版 `sha256('reminderweb-pin:' + 密码)` 的十六进制字符串（解锁后自动升级）。
   */
  appLockPasswordHash: StoredAppLock | null;
  /** 云备份：是否启用 WebDAV。 */
  webdavEnabled: boolean;
  /** 云备份：服务器地址（完整 URL）。 */
  webdavServer: string;
  /** 云备份：Basic 认证用户名。 */
  webdavUsername: string;
  /** 云备份：Basic 认证密码（仅存本地，绝不导出、绝不打印）。 */
  webdavPassword: string;
  /** 云备份：数据变动后是否自动上传（节流 60 秒）。 */
  webdavAutoBackup: boolean;
  /** 云备份：远端保留份数（1–100，默认 10）。 */
  webdavKeepCount: number;
  /** 云备份：上次成功时间（epoch 毫秒）。 */
  webdavLastSuccessAt: number | null;
  /** 云备份：上次结果文案（成功或失败原因）。 */
  webdavLastResult: string | null;
}

export interface PersistedData {
  reminders: ReminderItem[];
  tags: TagItem[];
  settings: AppSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  themeOption: 'SYSTEM',
  pureBlackEnabled: false,
  cardColoringEnabled: true,
  homeCategoryEnabled: true,
  defaultPage: 'COUNTDOWN',
  viewMode: 'CARD',
  scrollBehavior: 'HIDE_BOTTOM_BAR',
  dynamicColorEnabled: true,
  themeColorPalette: 'BLUE',
  customColorSeed: null,
  notificationEnabled: false,
  defaultAdvanceDays: 0,
  reminderMethod: 'APP_NOTIFICATION',
  backupReminderEnabled: false,
  backupEncryptionEnabled: true,
  lastBackupAt: null,
  appLockEnabled: false,
  appLockPasswordHash: null,
  webdavEnabled: false,
  webdavServer: '',
  webdavUsername: '',
  webdavPassword: '',
  webdavAutoBackup: false,
  webdavKeepCount: 10,
  webdavLastSuccessAt: null,
  webdavLastResult: null,
};

const store = createStore('reminderweb', 'kv');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 兼容旧版设置：历史上应用锁字段名为 `appLockPinHash`，新版为 `appLockPasswordHash`。
 * 旧值（v1 十六进制摘要）原样搬运，保证老用户仍能用自己的旧密码解锁。
 * 两字段冲突时：新字段若为结构完整的 v2 凭据则保留；否则回退到旧摘要（以可校验者为准）。
 * 纯函数，便于单测。
 */
export function migrateAppLockSettings(rawSettings: Record<string, unknown>): Record<string, unknown> {
  const next = { ...rawSettings };
  const legacy = next.appLockPinHash;
  if (legacy !== undefined) {
    if (next.appLockPasswordHash === undefined || !isAppLockCredential(next.appLockPasswordHash)) {
      next.appLockPasswordHash = legacy;
    }
    delete next.appLockPinHash;
  }
  return next;
}

/**
 * 兼容旧版设置：M7 起 WebDAV 凭据一度由服务端环境变量持有；
 * M10 客户端（纯前端）模式又需要浏览器直连，因此这里不再清空凭据，
 * 由运行模式决定「显示服务端策略面板」还是「浏览器直连输入框」。
 * 凭据属于仅本机设置，永不上传服务器、永不进导出备份。
 */
export async function loadPersistedData(): Promise<PersistedData> {
  const raw: unknown = await get(DATA_KEY, store);
  if (!isRecord(raw)) {
    return { reminders: [], tags: [], settings: { ...DEFAULT_SETTINGS } };
  }
  const reminders = Array.isArray(raw.reminders) ? normalizeReminderList(raw.reminders) : [];
  const tags = Array.isArray(raw.tags) ? normalizeTagList(raw.tags) : [];
  const rawSettings = isRecord(raw.settings) ? raw.settings : {};
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(migrateAppLockSettings(rawSettings) as Partial<AppSettings>),
  };
  return { reminders, tags, settings };
}

export async function savePersistedData(data: PersistedData): Promise<void> {
  await set(DATA_KEY, data, store);
}

/** 清空本地全部数据（结构化数据与图片）。 */
export async function clearAllData(): Promise<void> {
  await clear(store);
}

export function imageKey(name: string): string {
  return `${IMAGE_KEY_PREFIX}${name}`;
}

export async function saveImageBlob(name: string, blob: Blob): Promise<void> {
  await set(imageKey(name), blob, store);
}

export async function loadImageBlob(name: string): Promise<Blob | undefined> {
  return get<Blob>(imageKey(name), store);
}

export async function deleteImageBlob(name: string): Promise<void> {
  await del(imageKey(name), store);
}

export async function listImageNames(): Promise<string[]> {
  const all = await keys<string>(store);
  return all
    .filter((key) => typeof key === 'string' && key.startsWith(IMAGE_KEY_PREFIX))
    .map((key) => key.slice(IMAGE_KEY_PREFIX.length));
}

/** 用给定图片集合替换本地图片库：未出现在集合中的旧图片会被删除。 */
export async function replaceImageBlobs(images: Record<string, Blob>): Promise<void> {
  const existing = await listImageNames();
  for (const name of existing) {
    if (!Object.prototype.hasOwnProperty.call(images, name)) {
      await del(imageKey(name), store);
    }
  }
  for (const [name, blob] of Object.entries(images)) {
    await set(imageKey(name), blob, store);
  }
}

export function fontKey(name: string): string {
  return `${FONT_KEY_PREFIX}${name}`;
}

export async function listFontNames(): Promise<string[]> {
  const all = await keys<string>(store);
  return all
    .filter((key) => typeof key === 'string' && key.startsWith(FONT_KEY_PREFIX))
    .map((key) => key.slice(FONT_KEY_PREFIX.length));
}

export async function loadFontBlob(name: string): Promise<Blob | undefined> {
  return get<Blob>(fontKey(name), store);
}

/** 用给定字体集合替换本地字体库：未出现在集合中的旧字体会被删除。 */
export async function replaceFontBlobs(fonts: Record<string, Blob>): Promise<void> {
  const existing = await listFontNames();
  for (const name of existing) {
    if (!Object.prototype.hasOwnProperty.call(fonts, name)) {
      await del(fontKey(name), store);
    }
  }
  for (const [name, blob] of Object.entries(fonts)) {
    await set(fontKey(name), blob, store);
  }
}
