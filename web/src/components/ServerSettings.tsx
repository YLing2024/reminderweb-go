import { useState } from 'react';
import { useReminderStore } from '../store/useReminderStore';
import styles from './ServerSettings.module.css';

/**
 * 「服务器」分组（M10 §1）。
 *
 * - 顶部显示当前模式：服务器模式 / 客户端模式（纯前端）/ 未连接后端；
 * - 客户端模式：说明数据保存在本机浏览器、可通过 WebDAV 互通，隐藏账号 / 登录 / 后端同步状态；
 * - 服务器模式：保留 M9 的服务器信息与同步操作。
 */
function modeLabel(mode: string, serverReachable: boolean): string {
  if (mode === 'server') return serverReachable ? '服务器模式' : '未连接后端';
  if (mode === 'client') return '客户端模式（纯前端）';
  return '未连接后端';
}

function authLabel(authMode: string | null): string {
  if (authMode === 'builtin') return '账号密码（builtin）';
  if (authMode === 'sso') return '网关单点登录（sso）';
  if (authMode === 'none') return '无认证（none，仅开发）';
  return '未知';
}

export function ServerSettings({ onNotice }: { onNotice: (message: string) => void }) {
  const mode = useReminderStore((state) => state.mode);
  const authMode = useReminderStore((state) => state.authMode);
  const serverUser = useReminderStore((state) => state.serverUser);
  const serverVersion = useReminderStore((state) => state.serverVersion);
  const revision = useReminderStore((state) => state.revision);
  const serverReachable = useReminderStore((state) => state.serverReachable);
  const syncing = useReminderStore((state) => state.syncing);
  const syncError = useReminderStore((state) => state.syncError);
  const canUploadLocal = useReminderStore((state) => state.canUploadLocal);
  const syncNow = useReminderStore((state) => state.syncNow);
  const uploadLocalData = useReminderStore((state) => state.uploadLocalData);
  const logout = useReminderStore((state) => state.logout);
  const refresh = useReminderStore((state) => state.refresh);
  const [busy, setBusy] = useState(false);

  const runSync = async () => {
    setBusy(true);
    try {
      if (canUploadLocal) await uploadLocalData();
      else await syncNow();
      onNotice('已同步');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '同步失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const runLogout = async () => {
    setBusy(true);
    try {
      await logout();
      onNotice('已退出登录');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '退出登录失败');
    } finally {
      setBusy(false);
    }
  };

  const working = syncing || busy;

  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <span className={styles.rowTitle}>当前模式</span>
        <span className={styles.rowValue}>{modeLabel(mode, serverReachable)}</span>
      </div>

      {mode === 'client' ? (
        <p className={styles.hint}>
          数据保存在本机浏览器，可通过 WebDAV 备份与其它设备互通。下方「WebDAV 云备份」直接连接你的 WebDAV 服务器；
          账号、登录与后端同步状态在客户端模式下不可用。
        </p>
      ) : (
        <>
          <div className={styles.row}>
            <span className={styles.rowTitle}>认证方式</span>
            <span className={styles.rowValue}>{authLabel(authMode)}</span>
          </div>
          {serverUser !== null && (
            <div className={styles.row}>
              <span className={styles.rowTitle}>登录用户</span>
              <span className={styles.rowValue}>{serverUser}</span>
            </div>
          )}
          <div className={styles.row}>
            <span className={styles.rowTitle}>服务器版本</span>
            <span className={styles.rowValue}>{serverVersion ?? '—'}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowTitle}>数据修订号</span>
            <span className={styles.rowValue}>{revision ?? '—'}</span>
          </div>

          {syncError !== null && <p className={styles.error}>上次同步失败：{syncError}</p>}

          {mode !== 'server' && <p className={styles.hint}>尚未连接后端，数据只保存在本机浏览器。</p>}

          <div className={styles.buttons}>
            <button
              type="button"
              className={styles.secondary}
              disabled={working || mode !== 'server'}
              onClick={() => void runSync()}
            >
              {working ? '正在同步…' : canUploadLocal ? '上传本机数据' : '立即同步'}
            </button>
            {mode === 'server' && (
              <button type="button" className={styles.secondary} disabled={working} onClick={() => void refresh(true)}>
                从服务器刷新
              </button>
            )}
            {mode === 'server' && authMode === 'builtin' && (
              <button type="button" className={styles.danger} disabled={working} onClick={() => void runLogout()}>
                退出登录
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
