/**
 * 默认 / 弱口令提醒条（M12 §3.2）。
 *
 * 当服务器 `AUTH_MODE=builtin` 且口令仍是 `changeme` 或长度 < 8 时，设置页顶部显示本提醒，
 * 用户可关闭。口令本身不在这条提醒里出现。
 */
import styles from './AuthWarningBanner.module.css';

export function AuthWarningBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className={styles.banner} role="alert">
      <span className={styles.text}>
        服务器仍在使用默认口令或过短口令，存在被登录的风险，请尽快修改服务器的 AUTH_PASSWORD。
      </span>
      <button type="button" className={styles.close} onClick={onDismiss}>
        知道了
      </button>
    </div>
  );
}
