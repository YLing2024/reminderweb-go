/**
 * 导入 / 读取旧数据时的缺省归一化（纯函数，无副作用、不读时钟）。
 *
 * 背景：安卓端 `kotlinx.serialization` 默认 `encodeDefaults = false`，真实备份里的
 * 条目只携带「非默认值」字段（实测仅 7 个 key）。若直接当完整对象使用，缺失的
 * `endDate` 会绕过 `=== null` 判断并让日期解析抛错，最终整页白屏。
 *
 * 因此这里以 `defaultReminderFields()` 的默认表为基准，逐字段补齐类型安全的缺省值；
 * 既保证渲染稳定，又不丢弃安卓端未来新增的未知字段（原样保留）。
 */
import {
  DEFAULT_NOTIFICATION_CONFIG,
  defaultReminderFields,
  type NotificationTime,
  type ReminderItem,
  type ReminderNotificationConfig,
  type ReminderType,
  type RepeatInfo,
  type RepeatUnit,
  type TagItem,
} from '../types/reminder.ts';

/** 缺日期时的安全回落值（固定常量，保证纯函数不读时钟）。 */
export const FALLBACK_DATE = '1970-01-01';

const REMINDER_TYPES: readonly ReminderType[] = ['ANNUAL', 'COUNT_UP', 'BIRTHDAY'];
const REPEAT_UNITS: readonly RepeatUnit[] = ['DAY', 'WEEK', 'MONTH', 'YEAR'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function asNullableDateString(value: unknown): string | null {
  return typeof value === 'string' && ISO_DATE_RE.test(value) ? value : null;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function normalizeNotificationTime(raw: unknown): NotificationTime | null {
  if (!isRecord(raw)) return null;
  return {
    daysBefore: asInteger(raw.daysBefore, 0),
    time: asString(raw.time, '00:00:00'),
  };
}

/** 归一化通知配置；缺省或半缺对象都补齐为默认值。 */
export function normalizeNotificationConfig(raw: unknown): ReminderNotificationConfig {
  const source = isRecord(raw) ? raw : {};
  const rawTimes = Array.isArray(source.notificationTimes) ? source.notificationTimes : [];
  const notificationTimes = rawTimes
    .map(normalizeNotificationTime)
    .filter((entry): entry is NotificationTime => entry !== null);
  return {
    isEnabled: asBoolean(source.isEnabled, DEFAULT_NOTIFICATION_CONFIG.isEnabled),
    useAppNotification: asBoolean(source.useAppNotification, DEFAULT_NOTIFICATION_CONFIG.useAppNotification),
    useSystemCalendar: asBoolean(source.useSystemCalendar, DEFAULT_NOTIFICATION_CONFIG.useSystemCalendar),
    isContinuous: asBoolean(source.isContinuous, DEFAULT_NOTIFICATION_CONFIG.isContinuous),
    includeStartDay: asBoolean(source.includeStartDay, DEFAULT_NOTIFICATION_CONFIG.includeStartDay),
    notificationTimes,
  };
}

/** 归一化重复信息；`null`/缺失保持 `null`。 */
export function normalizeRepeatInfo(raw: unknown): RepeatInfo | null {
  if (raw === null || raw === undefined) return null;
  const source = isRecord(raw) ? raw : {};
  return {
    interval: asInteger(source.interval, 1),
    unit: asEnum(source.unit, REPEAT_UNITS, 'YEAR'),
    endDate: asNullableDateString(source.endDate),
  };
}

/**
 * 归一化单条提醒：
 * - 已知字段缺失/类型不符时回落到默认值；
 * - 安卓端未知字段（液态玻璃参数、未来新增字段）原样保留；
 * - `endDate`/`repeatInfo` 缺失补 `null`（正是白屏的直接根因）。
 */
export function normalizeReminderItem(raw: unknown): ReminderItem {
  const source = isRecord(raw) ? raw : {};
  const out = defaultReminderFields();

  // 先透传未知字段（可选玻璃参数 + 未来字段），再用已知字段覆盖。
  for (const [key, value] of Object.entries(source)) {
    if (!(key in out)) out[key] = value;
  }

  out.id = asInteger(source.id, 0);
  out.title = asString(source.title, '');
  out.date = typeof source.date === 'string' && ISO_DATE_RE.test(source.date) ? source.date : FALLBACK_DATE;
  out.endDate = asNullableDateString(source.endDate);
  out.type = asEnum(source.type, REMINDER_TYPES, 'ANNUAL');
  out.isLunar = asBoolean(source.isLunar, false);
  out.tag = asString(source.tag, '');
  out.isPinned = asBoolean(source.isPinned, false);
  out.repeatInfo = normalizeRepeatInfo(source.repeatInfo);
  out.notificationConfig = normalizeNotificationConfig(source.notificationConfig);
  out.notes = asString(source.notes, '');
  out.isCustomized = asBoolean(source.isCustomized, false);
  out.customHeaderColor = asString(source.customHeaderColor, '');
  out.customFont = asString(source.customFont, '');
  out.cardBackgroundType = asString(source.cardBackgroundType, 'DEFAULT');
  out.cardBackgroundColor = asString(source.cardBackgroundColor, '');
  out.cardBackgroundImagePath = asString(source.cardBackgroundImagePath, '');
  out.cardBackgroundBlurRadius = asNumber(source.cardBackgroundBlurRadius, 0);
  out.cardBackgroundGlassEnabled = asBoolean(source.cardBackgroundGlassEnabled, false);
  out.cardBackgroundGlassFrosted = asBoolean(source.cardBackgroundGlassFrosted, false);
  out.cardBackgroundGlassDensity = asNumber(source.cardBackgroundGlassDensity, 0.5);
  out.cardBackgroundTextColor = asString(source.cardBackgroundTextColor, '');
  out.customFontEffect = asString(source.customFontEffect, 'AUTO');
  out.customFontColor = asString(source.customFontColor, '');
  out.customFontOpacity = asNumber(source.customFontOpacity, 1);
  out.customFontBlur = asNumber(source.customFontBlur, 8);
  out.customFontWeight = asNumber(source.customFontWeight, 700);
  out.customFontShadowEnabled = asBoolean(source.customFontShadowEnabled, false);
  out.customFontStrokeEnabled = asBoolean(source.customFontStrokeEnabled, false);
  out.customFontStrokeColor = asString(source.customFontStrokeColor, '');
  return out;
}

/** 归一化标签；缺 `color` 补上游默认蓝，缺 `sortOrder` 补 0。保留同步元数据 `updatedAt`。 */
export function normalizeTagItem(raw: unknown): TagItem {
  const source = isRecord(raw) ? raw : {};
  const tag: TagItem = {
    id: asInteger(source.id, 0),
    name: asString(source.name, ''),
    color: asString(source.color, '#2196F3'),
    sortOrder: asInteger(source.sortOrder, 0),
  };
  if (typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt)) {
    tag.updatedAt = source.updatedAt;
  }
  return tag;
}

/** 归一化提醒列表；非数组按空处理，逐条归一化。 */
export function normalizeReminderList(raw: unknown): ReminderItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeReminderItem);
}

/** 归一化标签列表；非数组按空处理。 */
export function normalizeTagList(raw: unknown): TagItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeTagItem);
}
