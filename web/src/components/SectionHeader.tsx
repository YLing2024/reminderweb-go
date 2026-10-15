import { ChevronDownIcon, PinIcon, TagIcon } from './icons';
import styles from './SectionHeader.module.css';

export function SectionHeader({
  title,
  count,
  color,
  variant,
  collapsed,
  onToggle,
}: {
  title: string;
  count: number;
  color: string | null;
  variant: 'pinned' | 'tag' | 'uncategorized';
  collapsed: boolean;
  onToggle: () => void;
}) {
  const badgeStyle =
    variant === 'pinned'
      ? { background: 'color-mix(in srgb, var(--pinned-accent) 25%, transparent)', color: 'var(--pinned-accent)' }
      : variant === 'tag' && color !== null
        ? { background: `color-mix(in srgb, ${color} 22%, transparent)`, color }
        : { background: 'color-mix(in srgb, var(--neutral-badge) 25%, transparent)', color: 'var(--md-sys-color-on-surface-variant)' };

  return (
    <button type="button" className={styles.header} onClick={onToggle} aria-expanded={!collapsed}>
      <span className={styles.badge} style={badgeStyle}>
        {variant === 'pinned' ? <PinIcon width={18} height={18} /> : <TagIcon width={18} height={18} />}
      </span>
      <span className={styles.title}>{title}</span>
      <span className={styles.count}>{count}</span>
      <ChevronDownIcon className={`${styles.chevron} ${collapsed ? styles.chevronCollapsed : ''}`} width={20} height={20} />
    </button>
  );
}
