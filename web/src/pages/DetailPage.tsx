import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowBackIcon, DeleteIcon, EditIcon, PinIcon, ShareIcon } from '../components/icons';
import { ConfirmDialog, IconButton } from '../components/ui';
import { ShareImageDialog } from '../components/ShareImageDialog';
import { reminderDisplayInfo } from '../lib/display';
import { readableTextOn } from '../lib/contrast';
import { calculateBirthdayInfo } from '../lib/birthday';
import { parseLocalDate, todayLocalDate } from '../lib/local-date';
import type { ReminderType } from '../types/reminder';
import { useReminderStore } from '../store/useReminderStore';
import styles from './DetailPage.module.css';

const TYPE_COLOR: Record<ReminderType, string> = {
  ANNUAL: 'var(--type-annual)',
  COUNT_UP: 'var(--type-count-up)',
  BIRTHDAY: 'var(--type-birthday)',
};

export default function DetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const reminders = useReminderStore((state) => state.reminders);
  const tags = useReminderStore((state) => state.tags);
  const togglePin = useReminderStore((state) => state.togglePin);
  const deleteReminder = useReminderStore((state) => state.deleteReminder);

  const item = useMemo(
    () => reminders.find((entry) => entry.id === Number(id)),
    [reminders, id],
  );
  const [flipped, setFlipped] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showShare, setShowShare] = useState(false);

  if (item === undefined) {
    return (
      <div className={styles.missing}>
        <p>未找到该提醒</p>
        <button type="button" className={styles.backLink} onClick={() => navigate('/')}>
          返回首页
        </button>
      </div>
    );
  }

  const today = todayLocalDate();
  const info = reminderDisplayInfo(item, today);
  const tagColor = tags.find((tag) => tag.name.trim().toLowerCase() === item.tag.trim().toLowerCase())?.color ?? null;
  const bandColor =
    item.isCustomized && item.customHeaderColor.trim() !== '' ? item.customHeaderColor : (tagColor ?? TYPE_COLOR[item.type]);
  const birthdayInfo = item.type === 'BIRTHDAY' ? calculateBirthdayInfo(parseLocalDate(item.date), item.isLunar, today) : null;

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <IconButton label="返回" onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <h1 className={styles.title}>{item.title}</h1>
        <div className={styles.actions}>
          <IconButton label="编辑" onClick={() => navigate(`/reminder/${item.id}/edit`)}>
            <EditIcon />
          </IconButton>
          <IconButton label={item.isPinned ? '取消置顶' : '置顶'} pressed={item.isPinned} onClick={() => void togglePin(item.id)}>
            <PinIcon />
          </IconButton>
          <IconButton label="分享成图片" onClick={() => setShowShare(true)}>
            <ShareIcon />
          </IconButton>
          <IconButton label="删除" onClick={() => setConfirmDelete(true)}>
            <DeleteIcon />
          </IconButton>
        </div>
      </header>

      <div className={styles.content}>
        <button
          type="button"
          className={`${styles.flipper} ${flipped ? styles.flipped : ''}`}
          onClick={() => setFlipped((value) => !value)}
          aria-label={flipped ? '查看正面' : '查看备注'}
        >
          <div className={`${styles.face} ${styles.front}`}>
            <div className={styles.band} style={{ background: bandColor }}>
              <span className={styles.bandText} style={{ color: readableTextOn(bandColor) }}>
                {info.headerTitle}
              </span>
            </div>
            <div className={styles.body}>
              <span className={styles.number}>{info.isToday ? '今' : info.dayCount}</span>
              <span className={styles.unit}>天</span>
            </div>
            {info.intervalSubText !== null && <div className={styles.subText}>{info.intervalSubText}</div>}
            <div className={styles.footer}>{info.referenceText}</div>
          </div>
          <div className={`${styles.face} ${styles.back}`}>
            <span className={styles.backLabel}>备注</span>
            <p className={styles.notes}>{item.notes.trim() === '' ? '暂无备注' : item.notes}</p>
            <span className={styles.backHint}>点击卡片翻面</span>
          </div>
        </button>

        {birthdayInfo !== null && (
          <div className={styles.metaCard}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>年龄</span>
              <span className={styles.metaValue}>{birthdayInfo.age} 岁</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>生肖</span>
              <span className={styles.metaValue}>{birthdayInfo.chineseZodiac}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>星座</span>
              <span className={styles.metaValue}>{birthdayInfo.zodiac}</span>
            </div>
          </div>
        )}

        <div className={styles.infoList}>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>日期</span>
            <span className={styles.infoValue}>{item.date}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>类型</span>
            <span className={styles.infoValue}>
              {item.type === 'ANNUAL' ? '倒数日' : item.type === 'COUNT_UP' ? '正数日' : '生日'}
            </span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>标签</span>
            <span className={styles.infoValue}>{item.tag.trim() === '' ? '无标签' : item.tag}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>重复</span>
            <span className={styles.infoValue}>{item.repeatInfo === null ? '不重复' : `每 ${item.repeatInfo.interval} ${unitLabel(item.repeatInfo.unit)}`}</span>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="删除提醒"
        message={`确定删除「${item.title}」吗？此操作不可撤销。`}
        confirmText="删除"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void deleteReminder(item.id).then(() => navigate('/', { replace: true }));
        }}
      />

      {showShare && (
        <ShareImageDialog item={item} today={today} tagColor={tagColor} onClose={() => setShowShare(false)} />
      )}
    </div>
  );
}

function unitLabel(unit: string): string {
  switch (unit) {
    case 'DAY':
      return '天';
    case 'WEEK':
      return '周';
    case 'MONTH':
      return '月';
    case 'YEAR':
      return '年';
    default:
      return unit;
  }
}
