import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ThemeToggle } from './ThemeToggle';
import { THEME_OPTIONS, RESOLVED_THEME_KEY, readResolvedTheme, writeResolvedTheme } from '../lib/theme';

describe('ThemeToggle 顶栏主题控件', () => {
  const html = renderToString(createElement(ThemeToggle));

  it('暴露三态选项文本（自动 / 浅色 / 深色），不是亮暗两态', () => {
    for (const option of THEME_OPTIONS) {
      expect(html).toContain(option.label);
    }
    expect(THEME_OPTIONS).toHaveLength(3);
  });

  it('宽屏三选项控件为互斥的三选一（三个 aria-pressed）', () => {
    expect(html).toContain('role="group"');
    const pressed = html.match(/aria-pressed="(true|false)"/g) ?? [];
    expect(pressed).toHaveLength(3);
  });

  it('窄屏循环按钮暴露当前态与下一个目标态', () => {
    expect(html).toContain('data-theme-option="SYSTEM"');
    expect(html).toContain('点击切换为浅色');
  });
});

describe('首屏防闪缓存读写', () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      map,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    };
  }

  it('写入的是解析后的 light / dark', () => {
    const storage = fakeStorage();
    writeResolvedTheme(storage, true);
    expect(storage.map.get(RESOLVED_THEME_KEY)).toBe('dark');
    writeResolvedTheme(storage, false);
    expect(storage.map.get(RESOLVED_THEME_KEY)).toBe('light');
  });

  it('读取合法值，非法或缺失返回 null', () => {
    expect(readResolvedTheme(fakeStorage({ [RESOLVED_THEME_KEY]: 'dark' }))).toBe('dark');
    expect(readResolvedTheme(fakeStorage({ [RESOLVED_THEME_KEY]: 'purple' }))).toBeNull();
    expect(readResolvedTheme(fakeStorage())).toBeNull();
    expect(readResolvedTheme(null)).toBeNull();
  });

  it('存储抛错时静默处理，不向上冒泡', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readResolvedTheme(broken)).toBeNull();
    expect(() => writeResolvedTheme(broken, true)).not.toThrow();
  });
});
