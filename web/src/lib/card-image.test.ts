/**
 * M10 §3 卡片背景图：纯几何/命名函数，以及「写入 → 引用 → 导出包内含该图 → 重新导入仍可显示」的往返。
 * 通过 mock ./storage 把 IndexedDB 换成内存 Map，其余全部走真实代码路径。
 */
import { describe, expect, it, vi } from 'vitest';
import { decodeArchive } from './backup';
import { exportBackup, importBackup } from './backup-service';
import { CARD_IMAGE_MAX_EDGE, cardImageName, cardImagePath, fitDimensions, imageBasename } from './card-image';
import { DEFAULT_SETTINGS } from './storage';
import { makeItem } from '../test/factories';

const { imageStore } = vi.hoisted(() => ({ imageStore: new Map<string, Blob>() }));

vi.mock('./storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storage')>();
  return {
    ...actual,
    listImageNames: async () => [...imageStore.keys()],
    loadImageBlob: async (name: string) => imageStore.get(name),
    saveImageBlob: async (name: string, blob: Blob) => {
      imageStore.set(name, blob);
    },
    deleteImageBlob: async (name: string) => {
      imageStore.delete(name);
    },
    listFontNames: async () => [],
    loadFontBlob: async () => undefined,
    replaceImageBlobs: async (images: Record<string, Blob>) => {
      for (const name of [...imageStore.keys()]) {
        if (!Object.prototype.hasOwnProperty.call(images, name)) imageStore.delete(name);
      }
      for (const [name, blob] of Object.entries(images)) imageStore.set(name, blob);
    },
    replaceFontBlobs: async () => {},
  };
});

describe('fitDimensions：最长边等比缩放且不放大', () => {
  it('横图 / 竖图 / 方图缩到 maxEdge', () => {
    expect(fitDimensions(2160, 1080, 1080)).toEqual({ width: 1080, height: 540 });
    expect(fitDimensions(1080, 2160, 1080)).toEqual({ width: 540, height: 1080 });
    expect(fitDimensions(4000, 4000, 1080)).toEqual({ width: 1080, height: 1080 });
  });

  it('不超过上限时保持原尺寸；非法/非正尺寸兜底为 1', () => {
    expect(fitDimensions(800, 600, 1080)).toEqual({ width: 800, height: 600 });
    expect(fitDimensions(0, -5, 1080)).toEqual({ width: 1, height: 1 });
    expect(CARD_IMAGE_MAX_EDGE).toBe(1080);
  });
});

describe('命名与路径', () => {
  it('cardImageName：card-bg-<时间戳>-<随机>.jpg', () => {
    const name = cardImageName(new Date(2026, 9, 7, 16, 15, 3), () => 0.5);
    expect(name).toBe('card-bg-20261007-161503-8000.jpg');
  });

  it('cardImagePath：与安卓一致的 images/<name>', () => {
    expect(cardImagePath('bg.jpg')).toBe('images/bg.jpg');
    expect(cardImagePath('images/bg.jpg')).toBe('images/bg.jpg');
    expect(imageBasename('images/bg.jpg')).toBe('bg.jpg');
    expect(imageBasename('bg.jpg')).toBe('bg.jpg');
  });
});

describe('背景图往返（写入 → 引用 → 导出含图 → 导入仍可显示）', () => {
  it('导出包内含 images/<name>，重新导入后图片仍在', async () => {
    imageStore.clear();
    const bytes = new Uint8Array([9, 8, 7, 6, 5]);
    imageStore.set('bg.jpg', new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
    const reminder = makeItem({
      id: 1,
      isCustomized: true,
      cardBackgroundType: 'IMAGE',
      cardBackgroundImagePath: 'images/bg.jpg',
    });

    const result = await exportBackup([reminder], [], DEFAULT_SETTINGS, false, new Date(2026, 0, 1, 0, 0, 0));
    expect(result.imageCount).toBe(1);
    const archive = new Uint8Array(await result.blob.arrayBuffer());
    const content = await decodeArchive(archive);
    expect(Object.keys(content.images)).toEqual(['bg.jpg']);
    expect([...content.images['bg.jpg']!]).toEqual([...bytes]);

    // 模拟换设备：清空本地图片后从导出包恢复。
    imageStore.clear();
    const imported = await importBackup(archive);
    expect(imported.imageCount).toBe(1);
    expect(imported.reminders[0]!.cardBackgroundImagePath).toBe('images/bg.jpg');
    expect(imageStore.has('bg.jpg')).toBe(true);
    expect(new Uint8Array(await imageStore.get('bg.jpg')!.arrayBuffer())).toEqual(bytes);
  });

  it('未引用图片不会被带出（移除背景图后导出 imageCount 为 0）', async () => {
    imageStore.clear();
    imageStore.set('orphan.jpg', new Blob([new Uint8Array([1]) as BlobPart]));
    const reminder = makeItem({ id: 2, isCustomized: false, cardBackgroundType: 'DEFAULT', cardBackgroundImagePath: '' });
    const result = await exportBackup([reminder], [], DEFAULT_SETTINGS, false, new Date(2026, 0, 1));
    expect(result.imageCount).toBe(0);
    const content = await decodeArchive(new Uint8Array(await result.blob.arrayBuffer()));
    expect(Object.keys(content.images)).toEqual([]);
  });
});
