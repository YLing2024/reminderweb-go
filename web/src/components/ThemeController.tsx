import { useEffect, useState } from 'react';
import { applyTheme, resolveDark, writeResolvedTheme } from '../lib/theme';
import { useReminderStore } from '../store/useReminderStore';

function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * 把当前设置（主题三态 / 纯黑 / 卡片着色 / 种子色）应用到文档根元素。
 * 无副产物渲染；SSR 安全（effect 不在服务端运行）。
 */
export function ThemeController() {
  const settings = useReminderStore((state) => state.settings);
  const [systemDark, setSystemDark] = useState(prefersDark);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const dark = resolveDark(settings.themeOption, systemDark);
    applyTheme(document.documentElement, settings, dark);
    // 把解析后的明暗缓存到 localStorage，供 index.html 首屏内联脚本防闪。
    if (typeof window !== 'undefined') {
      try {
        writeResolvedTheme(window.localStorage, dark);
      } catch {
        // 存储不可用（隐私模式等）：忽略，不影响主题应用。
      }
    }
  }, [settings, systemDark]);

  return null;
}
