import { useState } from 'react';
import { ConfirmDialog } from './ui';
import { exportBackup } from '../lib/backup-service';
import { downloadBlob } from '../lib/download';
import {
  countsOf,
  migrationConfirmMessage,
  migrationResultMessage,
  switchBlockedReason,
  type MigrationCounts,
  type MigrationDirection,
} from '../lib/mode-migration';
import { listImageNames } from '../lib/storage';
import { useReminderStore, type StorageMode } from '../store/useReminderStore';
import styles from './ModeSettings.module.css';

type TargetMode = 'server' | 'client';

interface Pending {
  target: TargetMode;
  direction: MigrationDirection;
  counts: MigrationCounts;
}

function currentModeLabel(mode: string): string {
  if (mode === 'server') return '服务器模式';
  if (mode === 'client') return '客户端模式（纯前端）';
  return '检测中…';
}

/**
 * 设置页「运行模式」区域（M11 §1 §2）：
 * 提供服务器 ⇄ 客户端切换入口、当前模式、后端不可达时置灰服务器入口；
 * 切换前走迁移确认与迁移前自动备份，迁移成功才真正切模式。
 */
export function ModeSettings({
  onNotice,
  mode: modeProp,
  serverReachable: reachableProp,
}: {
  onNotice: (message: string) => void;
  /** 覆盖当前模式（测试 / SSR 用）；缺省读 store。 */
  mode?: StorageMode;
  /** 覆盖后端可达性（测试 / SSR 用）；缺省读 store。 */
  serverReachable?: boolean;
}) {
  const storeMode = useReminderStore((state) => state.mode);
  const storeReachable = useReminderStore((state) => state.serverReachable);
  const mode = modeProp ?? storeMode;
  const serverReachable = reachableProp ?? storeReachable;
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const serverEntryDisabled = switchBlockedReason(mode, 'server', serverReachable) !== null;
  const clientEntryDisabled = switchBlockedReason(mode, 'client', serverReachable) !== null;
  const working = busy || mode === 'unknown';

  const requestSwitch = async (target: TargetMode) => {
    if (switchBlockedReason(mode, target, serverReachable) !== null || working) return;
    const direction: MigrationDirection = target === 'client' ? 'server-to-client' : 'client-to-server';
    const state = useReminderStore.getState();
    const images = await listImageNames();
    setPending({ target, direction, counts: countsOf(state.reminders, state.tags, images) });
  };

  const runMigration = async (entry: Pending) => {
    setBusy(true);
    try {
      // 1) 迁移前自动兜底备份并下载；失败则中止迁移、保持原模式。
      const state = useReminderStore.getState();
      const backup = await exportBackup(
        state.reminders,
        state.tags,
        state.settings,
        state.settings.backupEncryptionEnabled,
      );
      downloadBlob(backup.blob, backup.fileName);
      onNotice(`已为你导出一份迁移前备份（${backup.fileName}），正在迁移…`);

      // 2) 整体迁移；成功后才真正切模式（store 内部写 localStorage）。
      const outcome =
        entry.direction === 'server-to-client'
          ? await useReminderStore.getState().migrateToClient()
          : await useReminderStore.getState().migrateToServer();

      const message = migrationResultMessage(entry.direction, outcome.counts, outcome.elapsedMs, outcome.revision);
      onNotice(outcome.verification.ok ? message : `${message}（核对异常：${outcome.verification.note}）`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : '请稍后重试';
      onNotice(`迁移失败：${reason}。已保持${mode === 'server' ? '服务器' : '客户端'}模式，数据未切换。`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <span className={styles.rowTitle}>当前模式</span>
        <span className={styles.rowValue}>{currentModeLabel(mode)}</span>
      </div>
      <p className={styles.hint}>
        服务器模式数据存在后端 SQLite；客户端模式数据存在本机浏览器。切换会整体迁移数据（覆盖式），
        并在迁移前自动导出一份备份。
      </p>

      <div className={styles.buttons}>
        <button
          type="button"
          className={mode === 'server' ? styles.active : styles.option}
          disabled={working || serverEntryDisabled}
          aria-pressed={mode === 'server'}
          onClick={() => void requestSwitch('server')}
        >
          服务器模式
        </button>
        <button
          type="button"
          className={mode === 'client' ? styles.active : styles.option}
          disabled={working || clientEntryDisabled}
          aria-pressed={mode === 'client'}
          onClick={() => void requestSwitch('client')}
        >
          客户端模式
        </button>
      </div>

      {serverEntryDisabled && mode !== 'server' && (
        <p className={styles.warn}>未检测到后端服务，无法切到服务器模式（当前部署为纯静态）。</p>
      )}
      {busy && <p className={styles.hint}>正在迁移，请勿关闭页面…</p>}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.target === 'server' ? '切到服务器模式' : '切到客户端模式'}
        message={pending === null ? '' : migrationConfirmMessage(pending.direction, pending.counts)}
        confirmText="迁移并切换"
        danger={pending?.direction === 'client-to-server'}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const entry = pending;
          setPending(null);
          if (entry !== null) void runMigration(entry);
        }}
      />
    </div>
  );
}
