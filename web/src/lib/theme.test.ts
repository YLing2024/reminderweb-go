import { describe, expect, it } from 'vitest';
import { argbFromHex } from '@material/material-color-utilities';
import indexHtml from '../../index.html?raw';
import {
  FALLBACK_SEED,
  RESOLVED_THEME_KEY,
  applyTheme,
  computeThemeVars,
  resolveDark,
  resolveSeedArgb,
  type ThemeSettings,
} from './theme';

const BASE: ThemeSettings = {
  themeOption: 'SYSTEM',
  pureBlackEnabled: false,
  cardColoringEnabled: true,
  dynamicColorEnabled: true,
  themeColorPalette: 'PURPLE',
  customColorSeed: null,
};

describe('resolveSeedArgb', () => {
  it('预置种子色命中对应色值', () => {
    expect(resolveSeedArgb('BLUE', null, true)).toBe(argbFromHex('#0061A4'));
    expect(resolveSeedArgb('PURPLE', null, true)).toBe(argbFromHex(FALLBACK_SEED));
  });

  it('自定义种子色使用所存 ARGB', () => {
    expect(resolveSeedArgb('CUSTOM', 0xff123456, true)).toBe(0xff123456);
  });

  it('自定义缺失时回退基线紫', () => {
    expect(resolveSeedArgb('CUSTOM', null, true)).toBe(argbFromHex(FALLBACK_SEED));
  });

  it('关闭跟随后忽略种子色，回退基线紫', () => {
    expect(resolveSeedArgb('GREEN', null, false)).toBe(argbFromHex(FALLBACK_SEED));
  });
});

describe('computeThemeVars', () => {
  it('生成完整的 --md-sys-color-* 与页面底色', () => {
    const vars = computeThemeVars(BASE, false);
    expect(vars['--md-sys-color-primary']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(vars['--md-sys-color-on-surface']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(vars['--app-page-bg']).toContain('color-mix');
  });

  it('明暗两套色板不同', () => {
    const light = computeThemeVars(BASE, false);
    const dark = computeThemeVars(BASE, true);
    expect(light['--md-sys-color-surface']).not.toBe(dark['--md-sys-color-surface']);
    expect(dark['--md-sys-color-primary']).not.toBe(light['--md-sys-color-primary']);
  });

  it('深色纯黑模式把底色压到纯黑', () => {
    const vars = computeThemeVars({ ...BASE, pureBlackEnabled: true }, true);
    expect(vars['--md-sys-color-surface']).toBe('#000000');
    expect(vars['--app-page-bg']).toBe('#000000');
  });

  it('浅色模式忽略纯黑', () => {
    const vars = computeThemeVars({ ...BASE, pureBlackEnabled: true }, false);
    expect(vars['--md-sys-color-surface']).not.toBe('#000000');
  });
});

describe('applyTheme', () => {
  it('同步 data-theme 与 color-scheme，并写入 CSS 变量', () => {
    const props = new Map<string, string>();
    const root = {
      dataset: {} as Record<string, string>,
      style: {
        colorScheme: '',
        setProperty: (key: string, value: string) => {
          props.set(key, value);
        },
      },
    };
    applyTheme(root as unknown as HTMLElement, BASE, true);
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(props.get('--md-sys-color-surface')).toMatch(/^#/);

    applyTheme(root as unknown as HTMLElement, BASE, false);
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');
  });
});

describe('resolveDark', () => {
  it('SYSTEM 时跟随系统偏好', () => {
    expect(resolveDark('SYSTEM', true)).toBe(true);
    expect(resolveDark('SYSTEM', false)).toBe(false);
  });

  it('LIGHT / DARK 时忽略系统偏好', () => {
    expect(resolveDark('LIGHT', true)).toBe(false);
    expect(resolveDark('DARK', false)).toBe(true);
  });
});

describe('index.html 首屏防闪内联脚本', () => {
  it('在 </head> 之前，引用同一缓存键并设置 data-theme / color-scheme / 中性底色', () => {
    const scriptAt = indexHtml.indexOf(RESOLVED_THEME_KEY);
    expect(scriptAt).toBeGreaterThan(-1);
    expect(scriptAt).toBeLessThan(indexHtml.indexOf('</head>'));
    expect(indexHtml).toContain('prefers-color-scheme');
    expect(indexHtml).toContain('dataset.theme');
    expect(indexHtml).toContain('colorScheme');
    expect(indexHtml).toContain('--app-page-bg');
  });
});

