// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThemeController } from './ThemeController';
import { useReminderStore } from '../store/useReminderStore';
import { RESOLVED_THEME_KEY } from '../lib/theme';
import { DEFAULT_SETTINGS } from '../lib/storage';

/**
 * auto（SYSTEM）态必须实时跟随系统偏好：
 * 本仓既有组件用例走 renderToString，无法驱动 useEffect；这里用 jsdom 挂真实 DOM，
 * 以可控的 MediaQueryList 替身触发 change，断言 data-theme 与防闪缓存同步改写。
 */

type ChangeListener = (event: MediaQueryListEvent) => void;

/** 可控的 window.matchMedia 替身：持有监听器，可手动翻转 matches 并派发 change。 */
class ControllableMediaQueryList {
  matches: boolean;
  readonly media: string;
  private readonly listeners = new Set<ChangeListener>();

  constructor(media: string, matches: boolean) {
    this.media = media;
    this.matches = matches;
  }

  addEventListener(type: string, listener: ChangeListener): void {
    if (type === 'change') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: ChangeListener): void {
    if (type === 'change') this.listeners.delete(listener);
  }

  /** 兼容旧式 API（部分实现仍走 addListener）。 */
  addListener(listener: ChangeListener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: ChangeListener): void {
    this.listeners.delete(listener);
  }

  /** 翻转系统偏好并派发 change，事件形状与浏览器一致。 */
  setMatches(matches: boolean): void {
    this.matches = matches;
    const event = { matches, media: this.media } as MediaQueryListEvent;
    for (const listener of [...this.listeners]) listener(event);
  }
}

const mediaQuery = '(prefers-color-scheme: dark)';

function installMatchMedia(initialMatches: boolean): ControllableMediaQueryList {
  const mql = new ControllableMediaQueryList(mediaQuery, initialMatches);
  (window as unknown as { matchMedia: (query: string) => MediaQueryList }).matchMedia = ((
    query: string,
  ) => (query === mediaQuery ? mql : new ControllableMediaQueryList(query, false))) as unknown as (
    query: string,
  ) => MediaQueryList;
  return mql;
}

interface FakeStorage {
  readonly map: Map<string, string>;
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
}

/**
 * Node 26 自带的实验性 `localStorage` 全局在未传 `--localstorage-file` 时返回 undefined，
 * 会遮蔽 jsdom 的实现；这里换成一个完全可控的替身，断言其写入内容。
 */
function makeFakeStorage(): FakeStorage {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

describe('ThemeController auto 态实时跟随系统偏好', () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let storage: FakeStorage;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    storage = makeFakeStorage();
    Object.defineProperty(window, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });
    document.documentElement.removeAttribute('data-theme');
    useReminderStore.setState({
      settings: { ...DEFAULT_SETTINGS, themeOption: 'SYSTEM' },
      loaded: true,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root !== undefined) {
      await act(async () => {
        root?.unmount();
      });
    }
    container.remove();
  });

  it('change(false→true) 后 data-theme 变 dark 且 resolved-theme 写为 dark；再 true→false 回到 light', async () => {
    const mql = installMatchMedia(false);

    await act(async () => {
      root = createRoot(container);
      root.render(<ThemeController />);
    });

    // 初始系统为浅色 → light。
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(storage.map.get(RESOLVED_THEME_KEY)).toBe('light');

    // 系统偏好切到深色：change 事件必须被监听器接住并重跑 applyTheme。
    await act(async () => {
      mql.setMatches(true);
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(storage.map.get(RESOLVED_THEME_KEY)).toBe('dark');

    // 切回浅色。
    await act(async () => {
      mql.setMatches(false);
    });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(storage.map.get(RESOLVED_THEME_KEY)).toBe('light');
  });

  it('非 auto（LIGHT）态忽略系统偏好变化，保持 light', async () => {
    useReminderStore.setState({ settings: { ...DEFAULT_SETTINGS, themeOption: 'LIGHT' } });
    const mql = installMatchMedia(false);

    await act(async () => {
      root = createRoot(container);
      root.render(<ThemeController />);
    });
    expect(document.documentElement.dataset.theme).toBe('light');

    await act(async () => {
      mql.setMatches(true);
    });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(storage.map.get(RESOLVED_THEME_KEY)).toBe('light');
  });
});
