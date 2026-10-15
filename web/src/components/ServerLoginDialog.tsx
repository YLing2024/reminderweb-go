import { useState } from 'react';
import { PasswordField } from './PasswordField';
import { useReminderStore } from '../store/useReminderStore';
import styles from './ServerLoginDialog.module.css';

/**
 * builtin 模式的内置登录界面：会话失效或首次访问时弹出。
 * 用户名 + 口令，口令支持显示 / 隐藏。
 */
export function ServerLoginDialog() {
  const authRequired = useReminderStore((state) => state.authRequired);
  const authMode = useReminderStore((state) => state.authMode);
  const login = useReminderStore((state) => state.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!authRequired || authMode !== 'builtin') return null;

  const submit = async () => {
    if (busy || username.trim() === '' || password === '') return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      setPassword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登录失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} role="presentation">
      <form
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="登录服务器"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className={styles.title}>登录服务器</h2>
        <p className={styles.hint}>需要登录后才能读取与保存数据。</p>
        <label className={styles.field}>
          <span className={styles.label}>用户名</span>
          <input
            className={styles.input}
            type="text"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(event) => {
              setError(null);
              setUsername(event.target.value);
            }}
          />
        </label>
        <PasswordField
          label="口令"
          value={password}
          visible={visible}
          onChange={(value) => {
            setError(null);
            setPassword(value);
          }}
          onToggleVisible={() => setVisible((value) => !value)}
          autoComplete="current-password"
          ariaLabel="口令"
        />
        {error !== null && <p className={styles.error}>{error}</p>}
        <button
          type="submit"
          className={styles.submit}
          disabled={busy || username.trim() === '' || password === ''}
        >
          {busy ? '正在登录…' : '登录'}
        </button>
      </form>
    </div>
  );
}
