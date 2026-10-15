/**
 * 云备份业务层（需求 M4 §3 / §7）：只负责「传输」。
 *
 * 备份产物的生成与解析一律复用本地导出/导入的同一份代码路径
 * （`lib/backup-service`），因此云端包与「导出为文件」逐字节一致、可互换。
 */
import type { ReminderItem, TagItem } from '../types/reminder';
import type { AppSettings } from './storage';
import { exportBackup, importBackup, type ImportResult } from './backup-service';
import {
  deleteBackup,
  downloadBackup,
  listBackups,
  pruneBackups,
  uploadBackup,
  type WebDavConfig,
  type WebDavDeps,
  type WebDavFile,
} from './webdav';

export interface CloudUploadOutcome {
  fileName: string;
  bytes: Uint8Array;
  imageCount: number;
  pruned: number;
}

export interface CloudBackupInput {
  reminders: ReminderItem[];
  tags: TagItem[];
  settings: AppSettings;
}

/** 从本地设置取出 WebDAV 连接参数。 */
export function webDavConfigFrom(settings: AppSettings): WebDavConfig {
  return {
    server: settings.webdavServer,
    username: settings.webdavUsername,
    password: settings.webdavPassword,
  };
}

/**
 * 生成与「导出为文件」完全相同的备份并上传；
 * 上传成功后按保留份数删除远端最旧的本应用备份。
 */
export async function uploadCurrentBackup(
  input: CloudBackupInput,
  deps: WebDavDeps = {},
  keepCount?: number,
): Promise<CloudUploadOutcome> {
  const config = webDavConfigFrom(input.settings);
  const now = deps.now?.() ?? new Date();
  const result = await exportBackup(
    input.reminders,
    input.tags,
    input.settings,
    input.settings.backupEncryptionEnabled,
    now,
  );
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  await uploadBackup(config, bytes, result.fileName, deps);
  const files = await listBackups(config, deps);
  const keep = keepCount ?? input.settings.webdavKeepCount;
  const pruned = await pruneBackups(config, files, keep, deps);
  return { fileName: result.fileName, bytes, imageCount: result.imageCount, pruned };
}

/** 列出远端备份（时间倒序）。 */
export async function listCloudBackups(settings: AppSettings, deps: WebDavDeps = {}): Promise<WebDavFile[]> {
  return listBackups(webDavConfigFrom(settings), deps);
}

/** 从云端下载并解析备份，走与本地导入相同的代码路径。 */
export async function restoreCloudBackup(
  settings: AppSettings,
  fileName: string,
  deps: WebDavDeps = {},
): Promise<ImportResult> {
  const config = webDavConfigFrom(settings);
  const bytes = await downloadBackup(config, fileName, deps);
  return importBackup(bytes);
}

/** 从 WebDAV 目录删除指定备份（客户端模式）。 */
export async function deleteCloudBackup(
  settings: AppSettings,
  fileName: string,
  deps: WebDavDeps = {},
): Promise<void> {
  await deleteBackup(webDavConfigFrom(settings), fileName, deps);
}
