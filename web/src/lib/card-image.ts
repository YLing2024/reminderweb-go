/**
 * 卡片背景图处理（M10 §3）。
 *
 * 编辑页选本地图片 → 解码 → 按最长边压到 1080、JPEG 质量 0.85 → 命名与安卓一致
 * （`images/<name>`，IndexedDB 键 `reminderweb:image:<name>`）。
 *
 * 纯几何 / 命名函数与 Canvas 处理分离，便于单测；`processCardImage` 只在浏览器调用。
 */

/** 压缩后最长边上限。 */
export const CARD_IMAGE_MAX_EDGE = 1080;
/** JPEG 质量。 */
export const CARD_IMAGE_JPEG_QUALITY = 0.85;
/** 备份包内图片目录（与安卓一致）。 */
export const CARD_IMAGE_DIR = 'images/';

export interface ProcessedCardImage {
  /** 文件名（basename，不含目录）。 */
  name: string;
  /** 与安卓一致的引用路径：`images/<name>`。 */
  path: string;
  blob: Blob;
  width: number;
  height: number;
}

/** 按最长边等比缩放；不放大，返回整数像素。纯函数。 */
export function fitDimensions(
  width: number,
  height: number,
  maxEdge: number = CARD_IMAGE_MAX_EDGE,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const longest = Math.max(w, h);
  if (!Number.isFinite(maxEdge) || maxEdge <= 0 || longest <= maxEdge) {
    return { width: w, height: h };
  }
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** 图片引用路径 → basename。 */
export function imageBasename(path: string): string {
  const parts = path.trim().split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

/** 与安卓一致的图片路径 `images/<name>`。 */
export function cardImagePath(name: string): string {
  return `${CARD_IMAGE_DIR}${imageBasename(name)}`;
}

/** 生成图片文件名：`card-bg-<yyyyMMdd-HHmmss>-<4位随机>.jpg`。 */
export function cardImageName(now: Date = new Date(), random: () => number = Math.random): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const stamp =
    `${pad(now.getFullYear(), 4)}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = Math.floor(random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
  return `card-bg-${stamp}-${suffix}.jpg`;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeImage(source: Blob): Promise<DecodedImage> {
  const createImageBitmap = (globalThis as { createImageBitmap?: (input: Blob, options?: unknown) => Promise<ImageBitmap> })
    .createImageBitmap;
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    } catch {
      // 少数浏览器不支持 imageOrientation 选项，回落到默认解码。
      bitmap = await createImageBitmap(source);
    }
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error('图片编码失败')) : resolve(blob)),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * 处理用户选择的本地图片：解码 → 等比缩放到最长边 maxEdge → JPEG 编码。
 * 返回文件名、`images/<name>` 路径与压缩后的 Blob。
 */
export async function processCardImage(
  file: Blob,
  options: { maxEdge?: number; quality?: number; now?: Date; random?: () => number } = {},
): Promise<ProcessedCardImage> {
  const maxEdge = options.maxEdge ?? CARD_IMAGE_MAX_EDGE;
  const quality = options.quality ?? CARD_IMAGE_JPEG_QUALITY;
  const decoded = await decodeImage(file);
  try {
    const size = fitDimensions(decoded.width, decoded.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('当前浏览器不支持 Canvas');
    context.drawImage(decoded.source, 0, 0, size.width, size.height);
    const blob = await canvasToBlob(canvas, quality);
    const name = cardImageName(options.now ?? new Date(), options.random ?? Math.random);
    return { name, path: cardImagePath(name), blob, width: size.width, height: size.height };
  } finally {
    decoded.release();
  }
}
