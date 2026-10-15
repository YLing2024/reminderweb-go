import { describe, expect, it } from 'vitest';
import { contrastRatio, readableTextOn } from './contrast';

const WHITE = { r: 255, g: 255, b: 255 };
const DARK = { r: 0x1d, g: 0x1b, b: 0x20 };

function toRgb(hex: string) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function chosenContrast(hex: string): number {
  return contrastRatio(toRgb(hex), readableTextOn(hex) === '#ffffff' ? WHITE : DARK);
}

describe('颜色对比度', () => {
  it('深色标签色用白字', () => {
    expect(readableTextOn('#0d47a1')).toBe('#ffffff');
    expect(chosenContrast('#0d47a1')).toBeGreaterThanOrEqual(4.5);
  });

  it('浅色标签色自动改深字且对比度 ≥4.5', () => {
    expect(readableTextOn('#ffeb3b')).toBe('#1d1b20');
    expect(readableTextOn('#f5f5f5')).toBe('#1d1b20');
    expect(chosenContrast('#ffeb3b')).toBeGreaterThanOrEqual(4.5);
    expect(chosenContrast('#f5f5f5')).toBeGreaterThanOrEqual(4.5);
  });

  it('默认调色板多数颜色可达到 ≥4.5', () => {
    for (const hex of ['#2196f3', '#4caf50', '#ff9800', '#9c27b0']) {
      expect(chosenContrast(hex)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('三位简写与非十六进制回退', () => {
    expect(readableTextOn('#fff')).toBe('#1d1b20');
    expect(readableTextOn('var(--type-annual)')).toBe('#ffffff');
  });
});
