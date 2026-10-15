/**
 * 卡片背景图 hook（M10 §3）：从 IndexedDB 读取提醒引用的本地图片，返回 object URL。
 *
 * 未配置图片、读不到或非浏览器环境时返回 null；卸载或切换时释放 object URL。
 */
import { useEffect, useState } from 'react';
import type { ReminderItem } from '../types/reminder';
import { imageBasename } from './card-image';
import { loadImageBlob } from './storage';

export function useCardBackgroundImage(item: ReminderItem): string | null {
  const path = item.isCustomized && item.cardBackgroundType === 'IMAGE' ? item.cardBackgroundImagePath.trim() : '';
  const name = path === '' ? '' : imageBasename(path);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (name === '') {
      setUrl(null);
      return undefined;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void loadImageBlob(name)
      .then((blob) => {
        if (cancelled || blob === undefined) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [name]);

  return url;
}
