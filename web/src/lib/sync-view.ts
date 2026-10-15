/**
 * 「WebDAV 云备份」分组的纯展示逻辑（M9 §3）：
 * 时间 / 大小 / 动作文案与「能否删除」判定，便于单测且与组件解耦。
 */
import type { SyncAction, SyncStatus } from './api';

/** 时间戳 → 本地时间文案。 */
export function formatSyncTime(timestamp: number | null): string {
  if (timestamp === null || timestamp <= 0) return '暂无';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

/** 字节数 → 可读大小。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 同步动作 → 中文短句。 */
export function actionLabel(action: SyncAction): string {
  if (action === 'upload') return '上传备份';
  if (action === 'pull') return '拉取合并';
  if (action === 'restore') return '从备份恢复';
  return '暂无';
}

/** 恢复结果里实际合并的条目数（更新 + 新增 + 删除）。 */
export function appliedTotal(applied: { updated: number; added: number; removed: number }): number {
  return applied.updated + applied.added + applied.removed;
}

/** 状态摘要里「上次结果」文案。 */
export function lastResultText(status: SyncStatus): string {
  if (status.lastResult === null) return '尚未同步';
  if (status.lastResult === 'ok') return '成功';
  return status.lastError === null ? '失败' : `失败：${status.lastError}`;
}

/** 服务器模式恢复前二次确认文案（M9 §3.7）：合并、不删本地、不删云端。 */
export function restoreConfirmMessage(name: string): string {
  return `将把「${name}」合并进当前数据，不会删除本地已有的条目，也不会删除云端文件。`;
}

/** 客户端模式恢复前二次确认文案：下载并覆盖本机全部数据。 */
export function restoreOverwriteConfirmMessage(name: string): string {
  return `将从云端下载「${name}」并覆盖当前全部数据，此操作不可撤销。`;
}

/** 删除前二次确认文案：点明同时会从 WebDAV 目录删除该文件。 */
export function deleteConfirmMessage(name: string): string {
  return `将从 WebDAV 目录删除「${name}」该文件，删除后无法恢复。`;
}
