import { useRef } from 'react';
import type { ReminderItem, ReminderType } from '../types/reminder';
import { reminderDisplayInfo, splitReferenceText } from '../lib/display';
import { readableTextOn } from '../lib/contrast';
import { useCardBackgroundImage } from '../lib/use-card-image';
import type { LocalDate } from '../lib/local-date';
import styles from './ReminderCard.module.css';

const TYPE_COLOR: Record<ReminderType, string> = {
  ANNUAL: 'var(--type-annual)',
  COUNT_UP: 'var(--type-count-up)',
  BIRTHDAY: 'var(--type-birthday)',
};

function resolveBandColor(item: ReminderItem, tagColor: string | null): string {
  if (item.isCustomized && item.customHeaderColor.trim() !== '') {
    return item.customHeaderColor;
  }
  if (tagColor !== null) return tagColor;
  return TYPE_COLOR[item.type];
}

export function ReminderCard({
  item,
  today,
  tagColor = null,
  large = false,
  onOpen,
  onRequestMenu,
}: {
  item: ReminderItem;
  today: LocalDate;
  tagColor?: string | null;
  large?: boolean;
  onOpen: () => void;
  onRequestMenu?: (point: { x: number; y: number } | null) => void;
}) {
  const info = reminderDisplayInfo(item, today, item.isLunar, true);
  const reference = splitReferenceText(info.referenceText, item.isLunar);
  const backgroundUrl = useCardBackgroundImage(item);
  // 浅色标签色时白字对比度不足，自动改用深色文字，保证 ≥4.5:1。
  const bandColor = resolveBandColor(item, tagColor);
  const bandTextColor = readableTextOn(bandColor);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const startPoint = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (onRequestMenu === undefined) return;
    longPressed.current = false;
    startPoint.current = { x: event.clientX, y: event.clientY };
    clearTimer();
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      onRequestMenu(startPoint.current);
    }, 500);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (startPoint.current === null) return;
    const dx = event.clientX - startPoint.current.x;
    const dy = event.clientY - startPoint.current.y;
    if (Math.hypot(dx, dy) > 10) clearTimer();
  };

  return (
    <button
      type="button"
      className={`${styles.card} ${large ? styles.large : ''}`}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        onOpen();
      }}
      onContextMenu={(event) => {
        if (onRequestMenu === undefined) return;
        event.preventDefault();
        onRequestMenu({ x: event.clientX, y: event.clientY });
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
      onPointerLeave={clearTimer}
    >
      <div className={styles.band} style={{ background: bandColor }}>
        <span
          className={styles.bandText}
          style={{ color: bandTextColor, textShadow: bandTextColor === '#ffffff' ? undefined : 'none' }}
        >
          {info.headerTitle}
        </span>
      </div>
      <div
        className={`${styles.body} ${backgroundUrl !== null ? styles.withImage : ''}`}
        style={backgroundUrl === null ? undefined : { backgroundImage: `url("${backgroundUrl}")` }}
      >
        <span className={styles.number}>{info.isToday ? '今' : info.dayCount}</span>
        <span className={styles.unit}>天</span>
      </div>
      <div className={styles.footer}>
        <span className={styles.footerText}>
          <span className={styles.footerPrefix}>{reference.prefix}</span>
          {reference.weekday !== '' && <span className={styles.footerWeekday}>{reference.weekday}</span>}
        </span>
      </div>
    </button>
  );
}
