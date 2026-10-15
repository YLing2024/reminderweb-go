import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowBackIcon, StorageIcon } from '../components/icons';
import { ConfirmDialog, IconButton, Toggle } from '../components/ui';
import { BackupError } from '../lib/backup';
import { exportBackup, importBackup } from '../lib/backup-service';
import { downloadBlob } from '../lib/download';
import { useReminderStore } from '../store/useReminderStore';
import styles from './BackupPage.module.css';

function daysSince(timestamp: number | null): number | null {
  if (timestamp === null) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

export default function BackupPage() {
  const navigate = useNavigate();
  const reminders = useReminderStore((state) => state.reminders);
  const tags = useReminderStore((state) => state.tags);
  const settings = useReminderStore((state) => state.settings);
  const updateSettings = useReminderStore((state) => state.updateSettings);
  const importData = useReminderStore((state) => state.importData);

  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const backupDays = daysSince(settings.lastBackupAt);

  const runExport = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await exportBackup(reminders, tags, settings, settings.backupEncryptionEnabled);
      downloadBlob(result.blob, result.fileName);
      await updateSettings({ lastBackupAt: Date.now() });
      setNotice(
        `已导出 ${result.fileName}（${settings.backupEncryptionEnabled ? '加密' : '未加密'}，含 ${result.imageCount} 张图片）`,
      );
    } catch {
      setNotice('导出失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const runImport = async (file: File) => {
    setBusy(true);
    setNotice(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await importBackup(bytes);
      await importData({ reminders: result.reminders, tags: result.tags, settings: result.settings });
      setNotice(`已恢复 ${result.reminders.length} 条提醒、${result.tags.length} 个标签、${result.imageCount} 张图片。`);
    } catch (error) {
      setNotice(error instanceof BackupError ? error.message : '导入失败：文件无法解析。');
    } finally {
      setBusy(false);
      if (fileInput.current !== null) fileInput.current.value = '';
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <IconButton label="返回" onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <h1 className={styles.title}>备份与恢复</h1>
      </header>

      <div className={styles.content}>
        {notice !== null && (
          <div className={styles.notice} role="status">
            <span>{notice}</span>
            <button type="button" className={styles.noticeClose} onClick={() => setNotice(null)}>
              知道了
            </button>
          </div>
        )}

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>
            <StorageIcon width={18} height={18} />
            导出备份
          </h2>
          <p className={styles.desc}>
            打包提醒、标签、主题与本地设置为 zip（metadata.json + images/），可直接导入安卓版 Reminder。
          </p>
          <p className={styles.desc}>自动备份与云端恢复在「设置 → WebDAV 云备份」，本页只负责本地文件导出/导入。</p>
          <div className={styles.switchRow}>
            <div className={styles.rowText}>
              <p className={styles.rowTitle}>加密（导出与自动上传共用，兼容安卓版）</p>
              <p className={styles.rowDesc}>按上游 AES/CBC 口径整包加密，导入时自动识别</p>
            </div>
            <Toggle
              checked={settings.backupEncryptionEnabled}
              label="加密备份"
              onChange={(next) => void updateSettings({ backupEncryptionEnabled: next })}
            />
          </div>
          <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void runExport()}>
            导出备份
          </button>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>恢复备份</h2>
          <p className={styles.desc}>
            选择安卓版或本应用导出的 zip 备份；加密包会自动识别。恢复将覆盖当前全部提醒、标签与设置。
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            className={styles.fileInput}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setPendingFile(file);
            }}
          />
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            选择备份文件
          </button>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>备份提醒</h2>
          <p className={styles.desc}>
            {settings.lastBackupAt === null
              ? '尚未备份'
              : `上次备份：${new Date(settings.lastBackupAt).toLocaleString('zh-CN', { hour12: false })}`}
            {settings.backupReminderEnabled && backupDays !== null && ` · 已 ${backupDays} 天未备份`}
          </p>
          <div className={styles.switchRow}>
            <div className={styles.rowText}>
              <p className={styles.rowTitle}>定期提醒备份</p>
              <p className={styles.rowDesc}>开启后依据上次备份时间提示备份</p>
            </div>
            <Toggle
              checked={settings.backupReminderEnabled}
              label="定期提醒备份"
              onChange={(next) => void updateSettings({ backupReminderEnabled: next })}
            />
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={pendingFile !== null}
        title="恢复备份"
        message={`将用「${pendingFile?.name ?? ''}」覆盖当前全部数据，此操作不可撤销。`}
        confirmText="覆盖恢复"
        danger
        onCancel={() => {
          setPendingFile(null);
          if (fileInput.current !== null) fileInput.current.value = '';
        }}
        onConfirm={() => {
          const file = pendingFile;
          setPendingFile(null);
          if (file !== null) void runImport(file);
        }}
      />
    </div>
  );
}
