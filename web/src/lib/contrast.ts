/**
 * 颜色对比度工具（WCAG 2.x 相对亮度）。
 *
 * 用于「浅色标签色」顶带：白字对比度不足时改用深色文字，保证 ≥4.5:1。
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const DARK: Rgb = { r: 0x1d, g: 0x1b, b: 0x20 };

function parseHexColor(value: string): Rgb | null {
  const hex = value.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(hex);
  if (short !== null) {
    const [r, g, b] = short[1]!.split('');
    return { r: parseInt(`${r}${r}`, 16), g: parseInt(`${g}${g}`, 16), b: parseInt(`${b}${b}`, 16) };
  }
  const long = /^#([0-9a-f]{6})$/i.exec(hex);
  if (long !== null) {
    const digits = long[1]!;
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
    };
  }
  return null;
}

function linearize(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(color: Rgb): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/** 两色对比度，范围 1–21。 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * 给定顶带背景色，返回可读前景色：
 * 优先白字；白字对比度 <4.5 时改用深字；两者都不足时取对比度更高者。
 * 非十六进制颜色（如类型色 CSS 变量）按深色处理，白字安全。
 */
export function readableTextOn(background: string): string {
  const rgb = parseHexColor(background);
  if (rgb === null) return '#ffffff';
  const white = contrastRatio(rgb, WHITE);
  if (white >= 4.5) return '#ffffff';
  if (contrastRatio(rgb, DARK) >= 4.5) return '#1d1b20';
  return white >= contrastRatio(rgb, DARK) ? '#ffffff' : '#1d1b20';
}
