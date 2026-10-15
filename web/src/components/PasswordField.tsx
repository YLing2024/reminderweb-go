import { PASSWORD_MAX_LENGTH } from '../lib/app-lock';
import styles from './PasswordField.module.css';

/**
 * 应用锁密码输入框：`type="password"` + 「显示 / 隐藏」切换。
 *
 * - 不受字符限制：不设 inputMode / pattern，maxLength 固定 128，不做任何过滤与 trim。
 * - 显示状态由父组件持有；切换按钮用 `type="button"` 且 `onMouseDown` 阻止默认，
 *   真触摸点击不会触发提交或让输入框失焦回弹。
 * - 聚焦时滚动到可视区中部，避免移动端键盘遮挡。
 */
export function PasswordField({
  label,
  value,
  visible,
  onChange,
  onToggleVisible,
  autoComplete,
  autoFocus = false,
  placeholder,
  ariaLabel,
  disabled = false,
}: {
  label?: string;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggleVisible: () => void;
  autoComplete?: string;
  autoFocus?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <label className={styles.wrap}>
      {label !== undefined && <span className={styles.label}>{label}</span>}
      <span className={styles.field}>
        <input
          className={styles.input}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          maxLength={PASSWORD_MAX_LENGTH}
          placeholder={placeholder}
          aria-label={ariaLabel ?? label}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'center' })}
        />
        <button
          type="button"
          className={styles.toggle}
          aria-label={visible ? '隐藏密码' : '显示密码'}
          aria-pressed={visible}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggleVisible}
        >
          {visible ? '隐藏' : '显示'}
        </button>
      </span>
    </label>
  );
}
