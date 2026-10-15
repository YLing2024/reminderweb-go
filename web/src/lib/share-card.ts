/**
 * 分享图绘制（§5.8）：用 Canvas 复刻卡片观感（色带、超大数字、日期带，
 * 以及自定义背景图 / 颜色、字体颜色与效果），输出正方形 PNG。
 *
 * 纯绘制函数，只在浏览器环境调用（构建期不实例化 Canvas）。
 */
import type { ReminderItem, ReminderType } from '../types/reminder';
import { reminderDisplayInfo, splitReferenceText } from './display';
import { readableTextOn } from './contrast';
import type { LocalDate } from './local-date';

const TYPE_COLOR: Record<ReminderType, string> = {
  ANNUAL: '#1e88e5',
  COUNT_UP: '#f28c20',
  BIRTHDAY: '#e53935',
};

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(value: string): Rgb | null {
  const hex = value.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(hex);
  if (short !== null) {
    const [r, g, b] = short[1]!.split('');
    return { r: parseInt(`${r}${r}`, 16), g: parseInt(`${g}${g}`, 16), b: parseInt(`${b}${b}`, 16) };
  }
  const long = /^#([0-9a-f]{6})$/i.exec(hex);
  if (long !== null) {
    const d = long[1]!;
    return { r: parseInt(d.slice(0, 2), 16), g: parseInt(d.slice(2, 4), 16), b: parseInt(d.slice(4, 6), 16) };
  }
  return null;
}

function luminance(rgb: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

function isDark(color: string | null): boolean {
  const rgb = color === null ? null : parseHex(color);
  return rgb !== null && luminance(rgb) < 0.45;
}

export function resolveBandColor(item: ReminderItem, tagColor: string | null): string {
  if (item.isCustomized && item.customHeaderColor.trim() !== '') return item.customHeaderColor;
  if (tagColor !== null) return tagColor;
  return TYPE_COLOR[item.type];
}

interface ShareCardInput {
  item: ReminderItem;
  today: LocalDate;
  tagColor: string | null;
  /** 自定义背景图（cardBackgroundType=IMAGE 且本地存在时），否则 null。 */
  backgroundImage: HTMLImageElement | HTMLCanvasElement | null;
}

/** 采样图片平均亮度（用于文字自动反色）。 */
function averageLuminance(image: HTMLImageElement | HTMLCanvasElement): number {
  const sample = document.createElement('canvas');
  sample.width = 16;
  sample.height = 16;
  const ctx = sample.getContext('2d');
  if (ctx === null) return 0;
  ctx.drawImage(image, 0, 0, 16, 16);
  const data = ctx.getImageData(0, 0, 16, 16).data;
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total += luminance({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! });
  }
  return total / (data.length / 4);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const iw = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const ih = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  if (iw === 0 || ih === 0) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/**
 * 在给定 canvas 上绘制分享图。canvas 尺寸固定为 1080×1080。
 */
export function drawShareCard(canvas: HTMLCanvasElement, input: ShareCardInput): void {
  const { item, today, tagColor, backgroundImage } = input;
  const size = 1080;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;

  const info = reminderDisplayInfo(item, today);
  const reference = splitReferenceText(info.referenceText, item.isLunar);
  const bandColor = resolveBandColor(item, tagColor);

  // 画布底色（分享图固定浅色，与上游分享页一致）。
  ctx.fillStyle = '#f7f5fa';
  ctx.fillRect(0, 0, size, size);

  const cardX = 90;
  const cardW = size - cardX * 2;
  const cardY = 250;
  const bandH = 120;
  const footerH = 110;
  const cardH = 620;
  const bodyY = cardY + bandH;
  const bodyH = cardH - bandH - footerH;
  const radius = 44;

  // 顶部字标：Reminder（手写体，无字体时回退衬线斜体）。
  ctx.fillStyle = '#6750a4';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '600 76px "Dancing Script", "Segoe Script", cursive, serif';
  ctx.fillText('Reminder', size / 2, 160);

  // 卡片阴影 + 背景。
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 12;
  roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.clip();

  // 卡片主体背景：IMAGE 用图片，COLOR 用颜色，DEFAULT 用浅色叠层。
  let bodyDark = false;
  if (item.isCustomized && item.cardBackgroundType === 'IMAGE' && backgroundImage !== null) {
    drawCover(ctx, backgroundImage, cardX, cardY, cardW, cardH);
    const lum = averageLuminance(backgroundImage);
    bodyDark = lum < 0.45;
  } else if (item.isCustomized && item.cardBackgroundType === 'COLOR' && item.cardBackgroundColor.trim() !== '') {
    ctx.fillStyle = item.cardBackgroundColor;
    ctx.fillRect(cardX, cardY, cardW, cardH);
    bodyDark = isDark(item.cardBackgroundColor);
  } else {
    ctx.fillStyle = '#f2eef8';
    ctx.fillRect(cardX, cardY, cardW, cardH);
  }

  // 色带。
  ctx.fillStyle = bandColor;
  ctx.fillRect(cardX, cardY, cardW, bandH);
  ctx.fillStyle = readableTextOn(bandColor);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '600 40px system-ui, "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(info.headerTitle, cardX + 40, cardY + bandH / 2, cardW - 80);

  // 字体颜色与效果。
  const manualText = item.cardBackgroundTextColor.trim().toUpperCase();
  let numberColor: string;
  if (manualText === 'WHITE') numberColor = '#ffffff';
  else if (manualText === 'BLACK') numberColor = '#1d1b20';
  else if (item.isCustomized && item.customFontEffect === 'SOLID' && item.customFontColor.trim() !== '') {
    numberColor = item.customFontColor;
  } else {
    numberColor = bodyDark ? '#ffffff' : '#1d1b20';
  }

  const weight = Math.min(900, Math.max(100, item.customFontWeight || 700));

  ctx.save();
  ctx.fillStyle = numberColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${weight} 240px "Helvetica Neue", Arial, system-ui, sans-serif`;
  if (item.customFontShadowEnabled) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = Math.min(24, Math.max(0, item.customFontBlur || 8));
    ctx.shadowOffsetY = 4;
  }
  const numberText = info.isToday ? '今' : String(info.dayCount);
  const numberY = bodyY + bodyH / 2;
  if (item.customFontStrokeEnabled) {
    ctx.lineWidth = 6;
    ctx.strokeStyle = item.customFontStrokeColor.trim() !== '' ? item.customFontStrokeColor : (bodyDark ? '#000000' : '#ffffff');
    ctx.strokeText(numberText, cardX + cardW * 0.42, numberY);
  }
  ctx.fillText(numberText, cardX + cardW * 0.42, numberY);
  ctx.restore();

  // 单位「天」。
  ctx.fillStyle = bodyDark ? 'rgba(255,255,255,0.85)' : '#5a5560';
  ctx.textAlign = 'left';
  ctx.font = '500 52px system-ui, "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('天', cardX + cardW * 0.42 + 190, numberY + 70);

  // 区间事件副标题。
  if (info.intervalSubText !== null) {
    ctx.fillStyle = bodyDark ? 'rgba(255,255,255,0.8)' : '#6b6570';
    ctx.textAlign = 'center';
    ctx.font = '400 32px system-ui, Arial, sans-serif';
    ctx.fillText(info.intervalSubText, cardX + cardW / 2, cardY + cardH - footerH - 24);
  }

  // 底部日期带。
  ctx.fillStyle = '#e5def0';
  ctx.fillRect(cardX, cardY + cardH - footerH, cardW, footerH);
  ctx.fillStyle = '#1d1b20';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '400 34px system-ui, "Helvetica Neue", Arial, sans-serif';
  const footerText = [reference.prefix, reference.weekday].filter((part) => part !== '').join(' ');
  ctx.fillText(footerText, cardX + cardW / 2, cardY + cardH - footerH / 2, cardW - 60);

  ctx.restore();

  // 底部：类型标签 + 应用名。
  const typeLabel = item.type === 'COUNT_UP' ? '正数日' : item.type === 'BIRTHDAY' ? '生日' : '倒数日';
  ctx.fillStyle = '#6750a4';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 36px system-ui, Arial, sans-serif';
  ctx.fillText(`${typeLabel} · Reminder`, size / 2, cardY + cardH + 80);
}
