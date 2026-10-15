/**
 * 备份业务层：在纯归档库（lib/backup）与 IndexedDB / store 之间做映射。
 *
 * - 导出：聚合提醒、标签、本地设置，读取被引用图片字节，打包（可选加密）为 Blob。
 * - 导入：解析归档，逐条校验后返回数据；图片写入 IndexedDB，元数据交给 store 落库。
 */
import type { BackupData, ReminderItem, TagItem } from '../types/reminder';
import type { AppSettings } from './storage';
import { listImageNames, loadImageBlob, replaceImageBlobs, listFontNames, loadFontBlob, replaceFontBlobs } from './storage';
import { stripSyncMeta } from './android-shape';
import {
  backupFileName,
  collectArchiveImages,
  decodeArchive,
  encodeArchive,
  parseBackupData,
  referencedImageNames,
  type ImportMetadataOptions,
} from './backup';

export interface ExportResult {
  blob: Blob;
  fileName: string;
  imageCount: number;
}

export interface ImportResult {
  reminders: ReminderItem[];
  tags: TagItem[];
  settings: Partial<AppSettings>;
  imageCount: number;
}

/**
 * 由当前应用状态构造备份结构（未内联图片，图片随 zip 走）。
 *
 * M12 §2：**绝不写入** `webDavServer / webDavUsername / webDavPassword / webDavPath`——
 * 这四个字段是进入 WebDAV 服务器的凭据，不该随备份包上传到那台服务器。其余字段与安卓格式
 * 保持一致。导入兼容逻辑见 `settingsFromBackup`。
 */
export function toBackupData(reminders: ReminderItem[], tags: TagItem[], settings: AppSettings): BackupData {
  return {
    reminders: reminders.map((item) => stripSyncMeta(item)) as ReminderItem[],
    tags: tags.map((item) => stripSyncMeta(item)) as TagItem[],
    themeOption: settings.themeOption,
    pureBlackEnabled: settings.pureBlackEnabled,
    cardColoringEnabled: settings.cardColoringEnabled,
    defaultPage: settings.defaultPage,
    viewMode: settings.viewMode,
    backupReminderEnabled: settings.backupReminderEnabled,
    dynamicColorEnabled: settings.dynamicColorEnabled,
    themeColorPalette: settings.themeColorPalette as BackupData['themeColorPalette'],
    customColorSeed: settings.customColorSeed,
    scrollBehavior: settings.scrollBehavior,
    homeCategoryEnabled: settings.homeCategoryEnabled,
    cardBackgroundImages: null,
  };
}

async function collectImages(reminders: ReminderItem[]): Promise<Record<string, Uint8Array>> {
  const names = referencedImageNames(reminders, null);
  const images: Record<string, Uint8Array> = {};
  for (const name of names) {
    const blob = await loadImageBlob(name);
    if (blob === undefined) continue;
    images[name] = new Uint8Array(await blob.arrayBuffer());
  }
  return images;
}

async function collectFonts(): Promise<Record<string, Uint8Array>> {
  const fonts: Record<string, Uint8Array> = {};
  for (const name of await listFontNames()) {
    const blob = await loadFontBlob(name);
    if (blob === undefined) continue;
    fonts[name] = new Uint8Array(await blob.arrayBuffer());
  }
  return fonts;
}

/** 导出：打包为 Blob（encrypt=true 时整包加密）。 */
export async function exportBackup(
  reminders: ReminderItem[],
  tags: TagItem[],
  settings: AppSettings,
  encrypt: boolean,
  now: Date = new Date(),
): Promise<ExportResult> {
  const metadata = toBackupData(reminders, tags, settings);
  const images = await collectImages(reminders);
  const fonts = await collectFonts();
  const bytes = await encodeArchive({ metadataJson: JSON.stringify(metadata), images, fonts }, encrypt);
  return {
    blob: new Blob([bytes as BlobPart], { type: 'application/zip' }),
    fileName: backupFileName(now),
    imageCount: Object.keys(images).length,
  };
}

/**
 * 把安卓备份的 `webDavServer` + `webDavPath` 合并成本机用的完整地址（M12 §2）。
 * `webDavServer` 可能是主机地址、`webDavPath` 是目录路径；避免重复拼接已有目录。
 */
function mergeWebDavPath(server: string, path: string | null | undefined): string {
  const trimmedPath = typeof path === 'string' ? path.trim() : '';
  if (trimmedPath === '') return server;
  const base = server.replace(/\/+$/, '');
  const suffix = trimmedPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (suffix === '' || base.endsWith(`/${suffix}`) || base === suffix) return server;
  return `${base}/${suffix}/`;
}

/** 把归档 metadata 里的可空设置映射为本地设置（纯函数，缺省字段不覆盖）。 */
export function settingsFromBackup(metadata: BackupData): Partial<AppSettings> {
  const settings: Partial<AppSettings> = {};
  if (metadata.themeOption !== null && metadata.themeOption !== undefined) settings.themeOption = metadata.themeOption;
  if (metadata.pureBlackEnabled !== null && metadata.pureBlackEnabled !== undefined) settings.pureBlackEnabled = metadata.pureBlackEnabled;
  if (metadata.cardColoringEnabled !== null && metadata.cardColoringEnabled !== undefined) settings.cardColoringEnabled = metadata.cardColoringEnabled;
  if (metadata.defaultPage !== null && metadata.defaultPage !== undefined) settings.defaultPage = metadata.defaultPage;
  if (metadata.viewMode !== null && metadata.viewMode !== undefined) settings.viewMode = metadata.viewMode;
  if (metadata.backupReminderEnabled !== null && metadata.backupReminderEnabled !== undefined) settings.backupReminderEnabled = metadata.backupReminderEnabled;
  if (metadata.dynamicColorEnabled !== null && metadata.dynamicColorEnabled !== undefined) settings.dynamicColorEnabled = metadata.dynamicColorEnabled;
  if (metadata.themeColorPalette !== null && metadata.themeColorPalette !== undefined) settings.themeColorPalette = metadata.themeColorPalette;
  if (metadata.customColorSeed !== null && metadata.customColorSeed !== undefined) settings.customColorSeed = metadata.customColorSeed;
  if (metadata.scrollBehavior !== null && metadata.scrollBehavior !== undefined) settings.scrollBehavior = metadata.scrollBehavior;
  if (metadata.homeCategoryEnabled !== null && metadata.homeCategoryEnabled !== undefined) settings.homeCategoryEnabled = metadata.homeCategoryEnabled;
  // M12 §2：兼容安卓备份里的 WebDAV 凭据字段，读入并用于填充本机配置；
  // 导出/上传侧不再写这四个字段，因此不会把口令二次外泄。
  if (typeof metadata.webDavServer === 'string' && metadata.webDavServer.trim() !== '') {
    settings.webdavServer = mergeWebDavPath(metadata.webDavServer.trim(), metadata.webDavPath);
  }
  if (typeof metadata.webDavUsername === 'string') settings.webdavUsername = metadata.webDavUsername;
  if (typeof metadata.webDavPassword === 'string') settings.webdavPassword = metadata.webDavPassword;
  return settings;
}

/** 导入：解析 + 校验 + 落库图片，返回可供 store 写入的数据。 */
export async function importBackup(bytes: Uint8Array, options: ImportMetadataOptions = {}): Promise<ImportResult> {
  const content = await decodeArchive(bytes);
  const metadata = parseBackupData(content.metadataJson, options);

  const imageBytes = collectArchiveImages(content, metadata);
  const blobs: Record<string, Blob> = {};
  for (const [name, data] of Object.entries(imageBytes)) {
    blobs[name] = new Blob([data as BlobPart]);
  }
  await replaceImageBlobs(blobs);

  const fontBlobs: Record<string, Blob> = {};
  for (const [name, data] of Object.entries(content.fonts)) {
    fontBlobs[name] = new Blob([data as BlobPart]);
  }
  await replaceFontBlobs(fontBlobs);

  return {
    reminders: Array.isArray(metadata.reminders) ? metadata.reminders : [],
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    settings: settingsFromBackup(metadata),
    imageCount: Object.keys(blobs).length,
  };
}

export { listImageNames };
