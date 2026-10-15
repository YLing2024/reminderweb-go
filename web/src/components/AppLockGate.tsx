import { useEffect, useRef, useState } from 'react';
import { LockIcon } from './icons';
import { PasswordField } from './PasswordField';
import { ConfirmDialog } from './ui';
import { verifyStoredPassword, isSessionUnlocked, markSessionUnlocked, clearSessionUnlocked, type AppLockCredential, type StoredAppLock } from '../lib/app-lock';
import { useReminderStore } from '../store/useReminderStore';
import styles from './AppLockGate.module.css';

const FORGOT_CONFIRM_WORD = '清空';

/**
 * 应用锁：开启后，应用启动或从后台切回（页面重新可见）时需输入应用锁密码解锁。
 * 未设置密码或功能关闭时不拦截。密码为任意字符，v1 旧 PIN 解锁成功后自动升级为 v2。
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const loaded = useReminderStore((state) => state.loaded);
  const settings = useReminderStore((state) => state.settings);
  const updateSettings = useReminderStore((state) => state.updateSettings);
  const resetAll = useReminderStore((state) => state.resetAll);
  // 解锁状态放在 sessionStorage：路由切换会重挂本组件，state 会丢，session 标记不会。
  const [locked, setLocked] = useState(() => !isSessionUnlocked());
  const [forgotOpen, setForgotOpen] = useState(false);
  const wasHidden = useRef(false);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        wasHidden.current = true;
        clearSessionUnlocked();
      } else if (wasHidden.current) {
        wasHidden.current = false;
        setLocked(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // 应用锁关闭（或没设密码）时不留解锁标记，重新开启后仍要先解锁。
  const enabled = loaded && settings.appLockEnabled && settings.appLockPasswordHash !== null;
  useEffect(() => {
    if (!enabled) clearSessionUnlocked();
  }, [enabled]);

  const stored = settings.appLockPasswordHash;
  const active = loaded && settings.appLockEnabled && stored !== null;
  if (!active || stored === null || !locked) return <>{children}</>;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.icon}>
          <LockIcon width={40} height={40} />
        </span>
        <h1 className={styles.title}>输入密码解锁</h1>
        <p className={styles.hint}>已开启应用锁</p>
        <UnlockForm
          stored={stored}
          onUnlock={(upgraded) => {
            if (upgraded !== null) void updateSettings({ appLockPasswordHash: upgraded });
            markSessionUnlocked();
            setLocked(false);
          }}
        />
        <button type="button" className={styles.forgot} onClick={() => setForgotOpen(true)}>
          忘记密码？
        </button>
      </div>

      <ConfirmDialog
        open={forgotOpen}
        title="忘记密码"
        message={`应用锁密码无法找回，只能清空本机全部数据后重新开始（提醒、标签与设置都会删除，云端备份需另行恢复）。请输入「${FORGOT_CONFIRM_WORD}」确认。`}
        confirmText="清空全部数据"
        danger
        requireText={FORGOT_CONFIRM_WORD}
        onCancel={() => setForgotOpen(false)}
        onConfirm={() => {
          void resetAll();
          setForgotOpen(false);
          clearSessionUnlocked();
          setLocked(false);
        }}
      />
    </div>
  );
}

export function UnlockForm({
  stored,
  onUnlock,
}: {
  stored: StoredAppLock;
  onUnlock: (upgraded: AppLockCredential | null) => void;
}) {
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    if (checking || password.length === 0) return;
    setChecking(true);
    const result = await verifyStoredPassword(password, stored);
    setChecking(false);
    if (result.ok) {
      setPassword('');
      onUnlock(result.upgraded);
    } else {
      setError(true);
      setPassword('');
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <PasswordField
        value={password}
        visible={visible}
        onChange={(value) => {
          setError(false);
          setPassword(value);
        }}
        onToggleVisible={() => setVisible((current) => !current)}
        autoComplete="current-password"
        autoFocus
        placeholder="应用锁密码"
        ariaLabel="应用锁密码"
      />
      {error && <p className={styles.error}>密码不正确</p>}
      <button type="submit" className={styles.submit} disabled={password.length === 0 || checking}>
        解锁
      </button>
    </form>
  );
}
