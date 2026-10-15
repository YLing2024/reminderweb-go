/**
 * 安卓备份包条目形状 ⇄ 内部条目形状 的共享映射（纯函数，前端与后端**同一份**）。
 *
 * 背景（M7 §0.1）：安卓 `kotlinx.serialization` 默认 `encodeDefaults = false`，导出的
 * `metadata.json` 条目只携带非默认字段（实测仅 7 个 key）：
 *   { id, title, date, type, tag, isLunar, isPinned }
 * 而内部形状（`src/types/reminder.ts`）是完整对象（`repeatInfo` / `notes` / 卡片个性化字段 …）。
 * 因此导入必须经过本模块：以 `normalize.ts` 的默认表补齐缺失字段（保留未知字段），
 * 并映射 `isLunar → isLunar`、`isPinned → isPinned`（同时兼容个别版本的 `lunar` / `pinned` 拼写）。
 *
 * `updatedAt`（同步合并所需的最后修改时间）**由调用方传入**：
 * - 手动导入本地文件：不传，条目不带 `updatedAt`（由 store 在服务器模式下写入）。
 * - WebDAV 同步导入：用备份文件的 `getlastmodified`（同批同值），保证合并幂等；
 *   **绝不用 `Date.now()`**，否则每轮同步都被判定为「有变化」。
 *
 * 本模块不读时钟、不写存储、不打印，任何调用方都可安全复用。
 */
import { type ReminderItem, type TagItem } from '../types/reminder.ts';
import { normalizeReminderItem, normalizeTagItem } from './normalize.ts';

/** 安卓备份包中的最简提醒条目：除 `id` 外字段均可缺省。 */
export interface AndroidReminderItem {
  id: number;
  title?: string;
  date?: string;
  type?: string;
  tag?: string;
  isLunar?: boolean;
  isPinned?: boolean;
  /** 安卓端未来新增字段原样保留。 */
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 兼容个别安卓版本使用的 `lunar` / `pinned` 拼写：
 * 仅在规范的 `isLunar` / `isPinned` 缺省时才作为回落，规范字段始终优先。
 */
function withFieldAliases(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const next: Record<string, unknown> = { ...raw };
  if (next.isLunar === undefined && next.lunar !== undefined) next.isLunar = next.lunar;
  if (next.isPinned === undefined && next.pinned !== undefined) next.isPinned = next.pinned;
  return next;
}

/**
 * 把安卓备份包条目转换为内部提醒条目。
 * `updatedAt` 缺省时不写入（手动本地导入场景）；传入时同批同值。
 */
export function fromAndroidReminder(raw: unknown, updatedAt?: number): ReminderItem {
  const item = normalizeReminderItem(withFieldAliases(raw));
  if (updatedAt !== undefined) item.updatedAt = updatedAt;
  return item;
}

/** 把安卓备份包标签转换为内部标签；`updatedAt` 语义同 `fromAndroidReminder`。 */
export function fromAndroidTag(raw: unknown, updatedAt?: number): TagItem {
  const tag = normalizeTagItem(raw);
  if (updatedAt !== undefined) tag.updatedAt = updatedAt;
  return tag;
}

/** 批量转换提醒条目；非数组按空处理。 */
export function fromAndroidReminderList(raw: unknown, updatedAt?: number): ReminderItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => fromAndroidReminder(entry, updatedAt));
}

/** 批量转换标签；非数组按空处理。 */
export function fromAndroidTagList(raw: unknown, updatedAt?: number): TagItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => fromAndroidTag(entry, updatedAt));
}

/**
 * 去掉同步元数据 `updatedAt`，得到可写入与安卓互通备份包的条目。
 * 内部与备份只差这一个字段，导出时统一走这里，避免出现第二套剥离逻辑。
 */
export function stripSyncMeta<T extends { updatedAt?: number }>(item: T): Omit<T, 'updatedAt'> {
  const copy: T = { ...item };
  delete copy.updatedAt;
  return copy;
}
