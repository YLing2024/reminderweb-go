import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  appliedTotal,
  deleteConfirmMessage,
  formatBytes,
  formatSyncTime,
  lastResultText,
  restoreConfirmMessage,
  restoreOverwriteConfirmMessage,
} from './sync-view';
import type { SyncStatus } from './api';

const STATUS: SyncStatus = {
  enabled: true,
  url: 'https://dav.example.com/reminder/',
  lastSyncAt: null,
  lastUploadAt: null,
  lastResult: null,
  lastError: null,
  pendingChanges: false,
  remoteFiles: [],
  nextSyncAt: null,
  lastMerged: 0,
  lastAction: 'none',
};

describe('sync-view 展示逻辑', () => {
  it('formatSyncTime：null/0 显示暂无，正数显示本地时间', () => {
    expect(formatSyncTime(null)).toBe('暂无');
    expect(formatSyncTime(0)).toBe('暂无');
    expect(formatSyncTime(1_700_000_000_000)).not.toBe('暂无');
  });

  it('formatBytes：B / KB / MB 与非法值', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatBytes(Number.NaN)).toBe('—');
  });

  it('actionLabel：四种动作的中文短句', () => {
    expect(actionLabel('upload')).toBe('上传备份');
    expect(actionLabel('pull')).toBe('拉取合并');
    expect(actionLabel('restore')).toBe('从备份恢复');
    expect(actionLabel('none')).toBe('暂无');
  });

  it('appliedTotal：更新 + 新增 + 删除之和', () => {
    expect(appliedTotal({ updated: 1, added: 2, removed: 3 })).toBe(6);
    expect(appliedTotal({ updated: 0, added: 0, removed: 0 })).toBe(0);
  });

  it('lastResultText：未同步 / 成功 / 失败含原因', () => {
    expect(lastResultText(STATUS)).toBe('尚未同步');
    expect(lastResultText({ ...STATUS, lastResult: 'ok' })).toBe('成功');
    expect(lastResultText({ ...STATUS, lastResult: 'error', lastError: null })).toBe('失败');
    expect(lastResultText({ ...STATUS, lastResult: 'error', lastError: '连不上' })).toBe('失败：连不上');
  });

  it('恢复确认文案：说明合并、不删本地、不删云端', () => {
    const message = restoreConfirmMessage('reminder-backup-20260101-120000.zip');
    expect(message).toContain('reminder-backup-20260101-120000.zip');
    expect(message).toContain('不会删除本地已有的条目');
    expect(message).toContain('也不会删除云端文件');
  });

  it('客户端覆盖恢复文案：说明覆盖本机全部数据', () => {
    const message = restoreOverwriteConfirmMessage('reminder-backup-20260101-120000.zip');
    expect(message).toContain('reminder-backup-20260101-120000.zip');
    expect(message).toContain('覆盖当前全部数据');
  });

  it('删除确认文案：给出文件名、点明从 WebDAV 目录删除且不可恢复', () => {
    const message = deleteConfirmMessage('reminder-backup-20260101-120000.zip');
    expect(message).toContain('reminder-backup-20260101-120000.zip');
    expect(message).toContain('WebDAV 目录');
    expect(message).toContain('无法恢复');
  });
});
