import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon } from './icons';
import { loadImageBlob } from '../lib/storage';
import { drawShareCard } from '../lib/share-card';
import type { LocalDate } from '../lib/local-date';
import type { ReminderItem } from '../types/reminder';
import styles from './ShareImageDialog.module.css';

async function loadBackgroundImage(item: ReminderItem): Promise<HTMLImageElement | null> {
  if (!item.isCustomized || item.cardBackgroundType !== 'IMAGE') return null;
  const path = item.cardBackgroundImagePath.trim();
  if (path === '') return null;
  const name = path.split(/[\\/]/).pop() ?? path;
  const blob = await loadImageBlob(name);
  if (blob === undefined) return null;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

export function ShareImageDialog({
  item,
  today,
  tagColor,
  onClose,
}: {
  item: ReminderItem;
  today: LocalDate;
  tagColor: string | null;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [canCopy, setCanCopy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function prepare(): Promise<void> {
      const image = await loadBackgroundImage(item);
      if (typeof document.fonts?.ready?.then === 'function') {
        await document.fonts.ready.catch(() => undefined);
      }
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (canvas !== null) drawShareCard(canvas, { item, today, tagColor, backgroundImage: image });
      setReady(true);
    }
    void prepare();
    return () => {
      cancelled = true;
    };
  }, [item, today, tagColor]);

  useEffect(() => {
    setCanCopy(
      typeof navigator !== 'undefined' &&
        typeof navigator.clipboard !== 'undefined' &&
        typeof navigator.clipboard.write === 'function' &&
        typeof (globalThis as { ClipboardItem?: unknown }).ClipboardItem === 'function',
    );
  }, []);

  const toPngBlob = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (canvas === null) {
        resolve(null);
        return;
      }
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }, []);

  const handleDownload = async () => {
    const blob = await toPngBlob();
    if (blob === null) {
      setNotice('生成图片失败。');
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `reminder-${item.id}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('已下载 PNG 图片。');
  };

  const handleCopy = async () => {
    const blob = await toPngBlob();
    if (blob === null) {
      setNotice('生成图片失败。');
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setNotice('已复制到剪贴板。');
    } catch {
      setNotice('复制失败，可改用下载。');
    }
  };

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="分享成图片"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>分享成图片</h2>
          <button type="button" className={styles.close} aria-label="关闭" onClick={onClose}>
            <CloseIcon width={20} height={20} />
          </button>
        </div>

        <div className={styles.preview}>
          <canvas ref={canvasRef} width={1080} height={1080} className={styles.canvas} aria-label="分享图预览" />
          {!ready && <span className={styles.loading}>正在生成…</span>}
        </div>

        {notice !== null && <p className={styles.notice}>{notice}</p>}

        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={!ready} onClick={() => void handleDownload()}>
            下载 PNG
          </button>
          {canCopy && (
            <button type="button" className={styles.secondary} disabled={!ready} onClick={() => void handleCopy()}>
              复制到剪贴板
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
