import type { ReactNode } from 'react';
import { THEME_OPTIONS, type ThemeOption } from '../lib/theme';
import { ContrastIcon, DarkModeIcon, LightModeIcon } from './icons';
import { useReminderStore } from '../store/useReminderStore';
import styles from './ThemeToggle.module.css';

const ICONS: Record<ThemeOption, ReactNode> = {
  SYSTEM: <ContrastIcon width={18} height={18} />,
  LIGHT: <LightModeIcon width={18} height={18} />,
  DARK: <DarkModeIcon width={18} height={18} />,
};

/**
 * 顶栏主题切换控件，与设置页共用同一个数据源（settings.themeOption）。
 *
 * 宽屏（≥600px）展示「自动 / 浅色 / 深色」三选项分段控件；
 * 窄屏收起为单个循环按钮（自动 → 浅色 → 深色 → 自动），三态都能选到且不挤坏顶栏。
 */
export function ThemeToggle() {
  const themeOption = useReminderStore((state) => state.settings.themeOption);
  const updateSettings = useReminderStore((state) => state.updateSettings);

  const activeIndex = Math.max(
    0,
    THEME_OPTIONS.findIndex((option) => option.value === themeOption),
  );
  const active = THEME_OPTIONS[activeIndex] ?? THEME_OPTIONS[0]!;
  const next = THEME_OPTIONS[(activeIndex + 1) % THEME_OPTIONS.length] ?? THEME_OPTIONS[0]!;

  return (
    <>
      <button
        type="button"
        className={styles.cycle}
        aria-label={`主题：${active.label}，点击切换为${next.label}`}
        title={`主题：${active.label}，点击切换为${next.label}`}
        data-theme-option={themeOption}
        onClick={() => void updateSettings({ themeOption: next.value })}
      >
        {ICONS[active.value]}
      </button>

      <div className={styles.group} role="group" aria-label="主题">
        {THEME_OPTIONS.map((option) => {
          const selected = option.value === themeOption;
          return (
            <button
              key={option.value}
              type="button"
              className={selected ? styles.itemActive : styles.item}
              aria-pressed={selected}
              title={option.label}
              onClick={() => void updateSettings({ themeOption: option.value })}
            >
              <span className={styles.icon}>{ICONS[option.value]}</span>
              <span className={styles.label}>{option.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
