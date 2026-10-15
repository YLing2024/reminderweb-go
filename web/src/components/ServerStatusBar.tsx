import { useReminderStore } from '../store/useReminderStore';
import styles from './ServerStatusBar.module.css';

/**
 * 全局服务器状态条（需求 §7 / M10 §1）：
 * - 客户端模式（纯前端）：明确标注「客户端模式」；
 * - 服务器为空而本机有旧数据：提示一键上传；
 * - 同步失败：中文提示并允许重试。
 */
export function ServerStatusBar() {
  const mode = useReminderStore((state) => state.mode);
  const canUploadLocal = useReminderStore((state) => state.canUploadLocal);
  const syncError = useReminderStore((state) => state.syncError);
  const serverNotice = useReminderStore((state) => state.serverNotice);
  const dismissServerNotice = useReminderStore((state) => state.dismissServerNotice);
  const syncing = useReminderStore((state) => state.syncing);
  const uploadLocalData = useReminderStore((state) => state.uploadLocalData);
  const syncNow = useReminderStore((state) => state.syncNow);

  if (mode === 'client') {
    return (
      <div className={styles.bar} data-kind="client" role="status">
        客户端模式 · 数据保存在本机浏览器，可通过 WebDAV 备份与其它设备互通
      </div>
    );
  }

  if (mode !== 'server') return null;

  if (canUploadLocal) {
    return (
      <div className={styles.bar} data-kind="action" role="status">
        <span className={styles.text}>检测到本机有旧数据，服务器为空。</span>
        <button type="button" className={styles.action} disabled={syncing} onClick={() => void uploadLocalData()}>
          {syncing ? '正在上传…' : '上传本机数据到服务器'}
        </button>
      </div>
    );
  }

  if (syncError !== null) {
    return (
      <div className={styles.bar} data-kind="error" role="alert">
        <span className={styles.text}>同步失败：{syncError}</span>
        <button type="button" className={styles.action} disabled={syncing} onClick={() => void syncNow()}>
          {syncing ? '正在重试…' : '重试'}
        </button>
      </div>
    );
  }

  if (serverNotice !== null) {
    return (
      <div className={styles.bar} data-kind="action" role="status">
        <span className={styles.text}>{serverNotice}</span>
        <button type="button" className={styles.action} onClick={dismissServerNotice}>
          知道了
        </button>
      </div>
    );
  }

  return null;
}
