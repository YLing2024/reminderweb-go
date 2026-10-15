/**
 * 主题引擎：用种子色经 material-color-utilities 生成 M3 明暗色板，
 * 写为 `--md-sys-color-*` CSS 变量（需求 §6.1：所有颜色只允许通过变量使用）。
 *
 * 浏览器取不到系统壁纸，故上游「动态取色」在 Web 端改为「跟随种子色」：
 * 打开时按所选种子色生成，关闭时回退 M3 基线紫。
 */
import { Scheme, argbFromHex, hexFromArgb } from '@material/material-color-utilities';

export type ThemeOption = 'SYSTEM' | 'LIGHT' | 'DARK';

/** 主题三态选项（顶栏控件与设置页共用同一份文案与取值）。 */
export const THEME_OPTIONS: Array<{ value: ThemeOption; label: string }> = [
  { value: 'SYSTEM', label: '自动' },
  { value: 'LIGHT', label: '浅色' },
  { value: 'DARK', label: '深色' },
];

/**
 * 首屏防闪缓存键：保存「system 感知后」解析出的最终明暗（light/dark），
 * 由 index.html 的 head 内联脚本在首屏绘制前读取；真正的调色板仍由 React 启动后的
 * ThemeController 应用，内联脚本只做最小必要的底色与 data-theme 防闪。
 */
export const RESOLVED_THEME_KEY = 'reminderweb:resolved-theme';

export type ResolvedTheme = 'light' | 'dark';

/** localStorage 的最小接口，便于在无 DOM 的单测里注入替身。 */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type ThemeColorPalette =
  | 'BLUE'
  | 'GREEN'
  | 'YELLOW'
  | 'ORANGE'
  | 'PURPLE'
  | 'PINK'
  | 'CYAN'
  | 'MONOCHROME'
  | 'CUSTOM';

export interface SeedPalette {
  key: Exclude<ThemeColorPalette, 'CUSTOM'>;
  label: string;
  seed: string;
}

/** 8 个预置种子色（与上游 AppColorPalette 对齐；单色即上游「黑白」）。 */
export const SEED_PALETTES: SeedPalette[] = [
  { key: 'BLUE', label: '蓝色', seed: '#0061A4' },
  { key: 'GREEN', label: '绿色', seed: '#006D3A' },
  { key: 'YELLOW', label: '黄色', seed: '#6A5F00' },
  { key: 'ORANGE', label: '橙色', seed: '#8B5000' },
  { key: 'PURPLE', label: '紫色', seed: '#6750A4' },
  { key: 'PINK', label: '粉色', seed: '#9C4174' },
  { key: 'CYAN', label: '青色', seed: '#006A6A' },
  { key: 'MONOCHROME', label: '单色', seed: '#5C5F62' },
];

/** M3 基线紫，作为无种子时的回退。 */
export const FALLBACK_SEED = '#6750A4';

/**
 * 由主题三态与系统偏好解析出最终明暗。
 * SYSTEM 时跟随系统；LIGHT / DARK 时忽略系统偏好。纯函数，便于单测。
 */
export function resolveDark(option: ThemeOption, systemDark: boolean): boolean {
  return option === 'DARK' || (option === 'SYSTEM' && systemDark);
}

/** 读取首屏防闪缓存（非法或缺失返回 null）。 */
export function readResolvedTheme(storage: ThemeStorage | null | undefined): ResolvedTheme | null {
  if (storage === null || storage === undefined) return null;
  try {
    const value = storage.getItem(RESOLVED_THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** 写入首屏防闪缓存；存储不可用时静默忽略。 */
export function writeResolvedTheme(
  storage: ThemeStorage | null | undefined,
  dark: boolean,
): void {
  if (storage === null || storage === undefined) return;
  try {
    storage.setItem(RESOLVED_THEME_KEY, dark ? 'dark' : 'light');
  } catch {
    // 隐私模式 / 存储被禁用：防闪缓存尽力而为，不影响主题应用。
  }
}

/** 解析当前设置应使用的种子色（ARGB 整数）。 */
export function resolveSeedArgb(
  palette: string,
  customColorSeed: number | null,
  followSeed: boolean,
): number {
  if (!followSeed) return argbFromHex(FALLBACK_SEED);
  if (palette === 'CUSTOM') {
    return customColorSeed ?? argbFromHex(FALLBACK_SEED);
  }
  const entry = SEED_PALETTES.find((item) => item.key === palette);
  return argbFromHex(entry?.seed ?? FALLBACK_SEED);
}

function schemeVars(scheme: Scheme): Record<string, string> {
  return {
    '--md-sys-color-primary': hexFromArgb(scheme.primary),
    '--md-sys-color-on-primary': hexFromArgb(scheme.onPrimary),
    '--md-sys-color-primary-container': hexFromArgb(scheme.primaryContainer),
    '--md-sys-color-on-primary-container': hexFromArgb(scheme.onPrimaryContainer),
    '--md-sys-color-secondary': hexFromArgb(scheme.secondary),
    '--md-sys-color-on-secondary': hexFromArgb(scheme.onSecondary),
    '--md-sys-color-secondary-container': hexFromArgb(scheme.secondaryContainer),
    '--md-sys-color-on-secondary-container': hexFromArgb(scheme.onSecondaryContainer),
    '--md-sys-color-tertiary': hexFromArgb(scheme.tertiary),
    '--md-sys-color-on-tertiary': hexFromArgb(scheme.onTertiary),
    '--md-sys-color-tertiary-container': hexFromArgb(scheme.tertiaryContainer),
    '--md-sys-color-on-tertiary-container': hexFromArgb(scheme.onTertiaryContainer),
    '--md-sys-color-error': hexFromArgb(scheme.error),
    '--md-sys-color-on-error': hexFromArgb(scheme.onError),
    '--md-sys-color-error-container': hexFromArgb(scheme.errorContainer),
    '--md-sys-color-on-error-container': hexFromArgb(scheme.onErrorContainer),
    '--md-sys-color-surface': hexFromArgb(scheme.surface),
    '--md-sys-color-on-surface': hexFromArgb(scheme.onSurface),
    '--md-sys-color-surface-variant': hexFromArgb(scheme.surfaceVariant),
    '--md-sys-color-on-surface-variant': hexFromArgb(scheme.onSurfaceVariant),
    '--md-sys-color-outline': hexFromArgb(scheme.outline),
    '--md-sys-color-outline-variant': hexFromArgb(scheme.outlineVariant),
    '--md-sys-color-inverse-surface': hexFromArgb(scheme.inverseSurface),
    '--md-sys-color-inverse-on-surface': hexFromArgb(scheme.inverseOnSurface),
    '--md-sys-color-inverse-primary': hexFromArgb(scheme.inversePrimary),
  };
}

export interface ThemeSettings {
  themeOption: ThemeOption;
  pureBlackEnabled: boolean;
  cardColoringEnabled: boolean;
  dynamicColorEnabled: boolean;
  themeColorPalette: string;
  customColorSeed: number | null;
}

/** 根据设置与明暗解析结果，计算整板 CSS 变量。 */
export function computeThemeVars(settings: ThemeSettings, dark: boolean): Record<string, string> {
  const seed = resolveSeedArgb(settings.themeColorPalette, settings.customColorSeed, settings.dynamicColorEnabled);
  const scheme = dark ? Scheme.dark(seed) : Scheme.light(seed);
  const vars = schemeVars(scheme);

  const surface = hexFromArgb(scheme.surface);
  const primary = hexFromArgb(scheme.primary);
  if (dark && settings.pureBlackEnabled) {
    vars['--md-sys-color-surface'] = '#000000';
    vars['--app-page-bg'] = '#000000';
  } else if (dark) {
    vars['--app-page-bg'] = surface;
  } else {
    // 页面底色略带紫调（需求 §6.1），由种子 surface 与 primary 轻混得到。
    vars['--app-page-bg'] = `color-mix(in srgb, ${surface} 92%, ${primary} 8%)`;
  }
  return vars;
}

/** 把主题写到 DOM：data-* 标记 + 内联 CSS 变量。 */
export function applyTheme(root: HTMLElement, settings: ThemeSettings, dark: boolean): void {
  const vars = computeThemeVars(settings, dark);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.pureBlack = dark && settings.pureBlackEnabled ? 'on' : 'off';
  root.dataset.cardColoring = settings.cardColoringEnabled ? 'on' : 'off';
  // 显式写 color-scheme：首屏内联脚本会设置内联 colorScheme，若运行时不覆盖会与 data-theme 不一致。
  root.style.colorScheme = dark ? 'dark' : 'light';
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
