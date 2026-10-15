import type { ReactNode } from 'react';
import { ArrowDownIcon, ArrowUpIcon, CakeIcon } from './icons';
import styles from './HomeNav.module.css';

export type HomeCategory = 'COUNTDOWN' | 'COUNTUP' | 'BIRTHDAY';

const ITEMS: Array<{ key: HomeCategory; label: string; icon: ReactNode }> = [
  { key: 'COUNTDOWN', label: '倒数日', icon: <ArrowDownIcon width={22} height={22} /> },
  { key: 'COUNTUP', label: '正数日', icon: <ArrowUpIcon width={22} height={22} /> },
  { key: 'BIRTHDAY', label: '生日', icon: <CakeIcon width={22} height={22} /> },
];

export function HomeNav({
  category,
  onChange,
  hidden = false,
}: {
  category: HomeCategory;
  onChange: (next: HomeCategory) => void;
  hidden?: boolean;
}) {
  return (
    <nav className={`${styles.nav} ${hidden ? styles.navHidden : ''}`} aria-label="首页分类">
      {ITEMS.map((item) => {
        const active = item.key === category;
        return (
          <button
            key={item.key}
            type="button"
            className={`${styles.item} ${active ? styles.itemActive : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onChange(item.key)}
          >
            <span className={styles.icon}>{item.icon}</span>
            <span className={styles.label}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
