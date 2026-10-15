/**
 * 备份归档读写（对齐安卓端 util/BackupArchiveManager.kt + BackupEncryptor.kt）。
 *
 * 归档：`.zip`，内含 `metadata.json`（BackupData）+ `images/<文件名>`（+ 可选 `fonts/`）。
 * 加密：整包 AES/CBC/PKCS5Padding，密钥 = SHA-256(seed)，seed[i] = obfuscated[i] XOR 90；
 *       密文布局 = [16 字节 IV][密文]（无分隔符、无 Base64）。Web 用 crypto.subtle 实现。
 *
 * 该模块保持纯函数（不触碰 IndexedDB / DOM），便于单测真实现往返。
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { BackupData, ReminderItem, TagItem } from '../types/reminder.ts';
import { fromAndroidReminderList, fromAndroidTagList } from './android-shape.ts';

export const BACKUP_EXTENSION = '.zip';
export const METADATA_ENTRY = 'metadata.json';
export const IMAGES_DIR = 'images/';
export const FONTS_DIR = 'fonts/';

/**
 * 上游 BackupEncryptor.kt 的 40 字节混淆常量（照抄，保证能解开安卓端加密备份）。
 * 密钥种子 = 每个字节 XOR 90，再做 SHA-256。
 */
export const OBFUSCATED_KEY: ReadonlyArray<number> = [
  40, 63, 55, 51, 52, 62, 63, 40, 41, 63, 57, 47, 40, 63, 124, 59, 57, 49, 47, 34, 41, 63, 63, 62, 44, 59, 54, 47, 63, 37,
  104, 106, 104, 110, 37, 35, 56, 62, 61, 54,
];

const IV_LENGTH = 16;

/** 备份包解析/解密失败时抛出，message 可直接展示给用户。 */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface ArchiveContent {
  metadataJson: string;
  images: Record<string, Uint8Array>;
  fonts: Record<string, Uint8Array>;
}

export interface ArchiveInput {
  metadataJson: string;
  images?: Record<string, Uint8Array>;
  fonts?: Record<string, Uint8Array>;
}

function xorSeed(): Uint8Array {
  const seed = new Uint8Array(OBFUSCATED_KEY.length);
  for (let i = 0; i < OBFUSCATED_KEY.length; i += 1) seed[i] = (OBFUSCATED_KEY[i]! ^ 90) & 0xff;
  return seed;
}

async function importAesKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', xorSeed());
  return crypto.subtle.importKey('raw', digest, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
}

/** 整包加密：返回 [16 字节 IV][密文]。 */
export async function encryptArchive(zipBytes: Uint8Array): Promise<Uint8Array> {
  const key = await importAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, zipBytes));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return out;
}

/** 解密整包；失败返回 null（调用方据此回退到明文 zip）。 */
export async function tryDecryptArchive(data: Uint8Array): Promise<Uint8Array | null> {
  if (data.length <= IV_LENGTH) return null;
  try {
    const key = await importAesKey();
    const iv = data.subarray(0, IV_LENGTH);
    const cipher = data.subarray(IV_LENGTH);
    const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, cipher);
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

function isZip(data: Uint8Array): boolean {
  // "PK\x03\x04"
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

/** 打包归档；encrypt=true 时整包加密（与安卓互解）。 */
export async function encodeArchive(input: ArchiveInput, encrypt: boolean): Promise<Uint8Array> {
  // fflate.defaults 下使用 mtime=0，避免打包时间进入 zip 头影响确定性。
  const files: Record<string, Uint8Array> = {};
  files[METADATA_ENTRY] = strToU8(input.metadataJson);
  for (const [name, bytes] of Object.entries(input.images ?? {})) {
    if (name.trim() === '') continue;
    files[IMAGES_DIR + basename(name)] = bytes;
  }
  for (const [name, bytes] of Object.entries(input.fonts ?? {})) {
    if (name.trim() === '') continue;
    files[FONTS_DIR + basename(name)] = bytes;
  }
  let zip: Uint8Array;
  try {
    // 固定 mtime，避免打包时间进入 zip 头，令同一输入产出稳定。
    zip = zipSync(files, { mtime: new Date(2020, 0, 1) });
  } catch {
    throw new BackupError('备份打包失败');
  }
  return encrypt ? encryptArchive(zip) : zip;
}

function basename(name: string): string {
  const parts = name.split(/[\\/]/);
  return parts[parts.length - 1] ?? name;
}

/**
 * 解析归档：优先按加密包解密，失败则按明文 zip 处理（与上游 decode 一致）。
 * 缺 metadata.json / 非法 zip 时抛 BackupError，调用方不得写入任何数据。
 */
export async function decodeArchive(data: Uint8Array): Promise<ArchiveContent> {
  let zipBytes: Uint8Array;
  if (isZip(data)) {
    zipBytes = data;
  } else {
    const decrypted = await tryDecryptArchive(data);
    if (decrypted === null) {
      throw new BackupError('无法识别该备份包：既不是有效的 zip，也无法用上游密钥解密。');
    }
    if (!isZip(decrypted)) {
      throw new BackupError('解密结果不是有效的备份 zip。');
    }
    zipBytes = decrypted;
  }
  return parseZip(zipBytes);
}

function parseZip(zipBytes: Uint8Array): ArchiveContent {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    throw new BackupError('备份包已损坏，无法解压。');
  }
  const metadataBytes = entries[METADATA_ENTRY];
  if (metadataBytes === undefined) {
    throw new BackupError('备份包缺少 metadata.json，无法恢复。');
  }
  const images: Record<string, Uint8Array> = {};
  const fonts: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.startsWith(IMAGES_DIR)) images[basename(name)] = bytes;
    else if (name.startsWith(FONTS_DIR)) fonts[basename(name)] = bytes;
  }
  return { metadataJson: strFromU8(metadataBytes), images, fonts };
}

export interface ImportMetadataOptions {
  /**
   * 该批条目统一的最后修改时间（epoch 毫秒）。
   * WebDAV 同步用备份文件的 `getlastmodified` 传入；手动导入不传。
   */
  updatedAt?: number;
}

/** 解析并粗校验 metadata.json（reminders 必须为数组）。 */
export function parseBackupData(metadataJson: string, options: ImportMetadataOptions = {}): BackupData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataJson);
  } catch {
    throw new BackupError('metadata.json 不是合法 JSON。');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new BackupError('metadata.json 结构不正确。');
  }
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.reminders)) {
    throw new BackupError('metadata.json 缺少 reminders 列表。');
  }
  // 安卓 encodeDefaults=false：条目缺省字段经共享映射补齐后再交给渲染层。
  const tags = record.tags;
  return {
    ...(parsed as BackupData),
    reminders: fromAndroidReminderList(record.reminders, options.updatedAt),
    tags: Array.isArray(tags) ? fromAndroidTagList(tags, options.updatedAt) : null,
  };
}

/** 备份文件名，与上游 generateBackupFileName 一致：reminder-backup-yyyyMMdd-HHmmss.zip。 */
export function backupFileName(date: Date = new Date()): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const stamp =
    `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `reminder-backup-${stamp}${BACKUP_EXTENSION}`;
}

/** 取消引用的图片文件名（供导出打包使用）。 */
export function referencedImageNames(reminders: ReminderItem[], extra: Record<string, string> | null): string[] {
  const names = new Set<string>();
  for (const item of reminders) {
    const path = item.cardBackgroundImagePath?.trim() ?? '';
    if (path !== '') names.add(basename(path));
  }
  if (extra !== null) {
    for (const name of Object.keys(extra)) {
      if (name.trim() !== '') names.add(basename(name));
    }
  }
  return [...names];
}

/** 从 metadata 的 cardBackgroundImages（文件名 -> base64）还原图片字节。 */
export function decodeInlineImages(images: Record<string, string> | null | undefined): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {};
  if (images === null || images === undefined) return result;
  for (const [name, base64] of Object.entries(images)) {
    if (name.trim() === '' || typeof base64 !== 'string') continue;
    const bytes = base64ToBytes(base64);
    if (bytes !== null) result[basename(name)] = bytes;
  }
  return result;
}

function base64ToBytes(value: string): Uint8Array | null {
  const cleaned = value.replace(/^data:[^;]+;base64,/, '');
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** 由归档内容组装可写入存储的数据（图片名 -> 字节）。 */
export function collectArchiveImages(content: ArchiveContent, metadata: BackupData): Record<string, Uint8Array> {
  return { ...decodeInlineImages(metadata.cardBackgroundImages), ...content.images };
}

export type { BackupData, ReminderItem, TagItem };
