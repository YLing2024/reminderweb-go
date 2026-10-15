import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowBackIcon, SaveIcon, ChevronRightIcon, PlusIcon, CloseIcon } from '../components/icons';
import { IconButton, Toggle } from '../components/ui';
import { createReminderItem, type NotificationTime, type ReminderItem, type ReminderType, type RepeatUnit } from '../types/reminder';
import { imageBasename, processCardImage } from '../lib/card-image';
import { deleteImageBlob, saveImageBlob } from '../lib/storage';
import {
  lunarDayLabel,
  lunarMonthsOfYear,
  lunarToSolar,
  solarToLunar,
} from '../lib/lunar';
import { parseLocalDate, toISODate, todayLocalDate, type LocalDate } from '../lib/local-date';
import { applyTypeDefaults } from '../lib/reminder-rules';
import { useReminderStore } from '../store/useReminderStore';
import styles from './EditPage.module.css';

const TYPE_LABELS: Array<{ value: ReminderType; label: string }> = [
  { value: 'ANNUAL', label: '倒数日' },
  { value: 'COUNT_UP', label: '正数日' },
  { value: 'BIRTHDAY', label: '生日' },
];

const UNIT_LABELS: Array<{ value: RepeatUnit; label: string }> = [
  { value: 'DAY', label: '天' },
  { value: 'WEEK', label: '周' },
  { value: 'MONTH', label: '月' },
  { value: 'YEAR', label: '年' },
];

function repeatSummary(item: ReminderItem, hasEndDate: boolean): string {
  const repeat = item.repeatInfo;
  if (repeat === null) return '不重复';
  const unit = UNIT_LABELS.find((entry) => entry.value === repeat.unit)?.label ?? repeat.unit;
  const base = `每 ${repeat.interval} ${unit}`;
  if (hasEndDate && repeat.endDate !== null) return `${base} · 至 ${repeat.endDate}`;
  return base;
}

function notificationSummary(item: ReminderItem): string {
  const config = item.notificationConfig;
  if (!config.isEnabled || config.notificationTimes.length === 0) return '未开启';
  return `${config.notificationTimes.length} 条`;
}

export default function EditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const reminders = useReminderStore((state) => state.reminders);
  const tags = useReminderStore((state) => state.tags);
  const addReminder = useReminderStore((state) => state.addReminder);
  const updateReminder = useReminderStore((state) => state.updateReminder);
  const addTag = useReminderStore((state) => state.addTag);
  const defaultAdvanceDays = useReminderStore((state) => state.settings.defaultAdvanceDays);

  const existing = useMemo(
    () => (id === undefined ? undefined : reminders.find((item) => item.id === Number(id))),
    [id, reminders],
  );
  const isEditing = id !== undefined;

  const [draft, setDraft] = useState<ReminderItem>(() =>
    existing ?? createReminderItem({ title: '', date: toISODate(todayLocalDate()), type: 'ANNUAL' }),
  );
  const [showRepeat, setShowRepeat] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);

  useEffect(() => {
    if (existing !== undefined) setDraft(existing);
  }, [existing]);

  const isInterval = draft.type === 'ANNUAL';

  const patch = (partial: Partial<ReminderItem>) => setDraft((current) => ({ ...current, ...partial }));

  const pickBackgroundImage = async (file: File | undefined) => {
    if (file === undefined) return;
    setImageBusy(true);
    setError(null);
    try {
      const processed = await processCardImage(file);
      const previous = imageBasename(draft.cardBackgroundImagePath);
      await saveImageBlob(processed.name, processed.blob);
      if (previous !== '' && previous !== processed.name) {
        try {
          await deleteImageBlob(previous);
        } catch {
          // 旧图清理失败不影响新图使用。
        }
      }
      patch({ cardBackgroundType: 'IMAGE', cardBackgroundImagePath: processed.path });
    } catch {
      setError('背景图处理失败，请换一张图片重试');
    } finally {
      setImageBusy(false);
    }
  };

  const removeBackgroundImage = async () => {
    const previous = imageBasename(draft.cardBackgroundImagePath);
    if (previous !== '') {
      try {
        await deleteImageBlob(previous);
      } catch {
        // 图片可能已被其它流程清理，忽略。
      }
    }
    patch({ cardBackgroundType: 'DEFAULT', cardBackgroundImagePath: '' });
  };

  const setLunarDate = (year: number, month: number, day: number) => {
    const dayCount = lunarMonthsOfYear(year).find((entry) => entry.month === month)?.dayCount ?? 30;
    const safeDay = Math.min(day, dayCount);
    patch({ date: toISODate(lunarToSolar({ year, month, day: safeDay })) });
  };

  const handleSave = async () => {
    const title = draft.title.trim();
    if (title === '') {
      setError('请填写标题');
      return;
    }
    const normalized: ReminderItem = applyTypeDefaults({ ...draft, title }, draft.type);
    await addTag(normalized.tag);
    if (isEditing) {
      await updateReminder(normalized);
      navigate(`/reminder/${normalized.id}`, { replace: true });
    } else {
      const newId = await addReminder(normalized);
      navigate(`/reminder/${newId}`, { replace: true });
    }
  };

  const notificationTimes = draft.notificationConfig.notificationTimes;
  const updateTimes = (next: NotificationTime[]) => {
    patch({ notificationConfig: { ...draft.notificationConfig, notificationTimes: next } });
  };

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <IconButton label="返回" onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <h1 className={styles.title}>{isEditing ? '编辑提醒' : '新增提醒'}</h1>
        <IconButton label="保存" onClick={() => void handleSave()}>
          <SaveIcon />
        </IconButton>
      </header>

      <div className={styles.content}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>标题</span>
          <input
            className={styles.input}
            value={draft.title}
            placeholder="标题"
            maxLength={80}
            onChange={(event) => patch({ title: event.target.value })}
          />
        </label>
        {error !== null && <p className={styles.error}>{error}</p>}

        <div className={styles.field}>
          <div className={styles.fieldHeader}>
            <span className={styles.fieldLabel}>日期</span>
            <div className={styles.segmented}>
              <button
                type="button"
                className={!draft.isLunar ? styles.segmentActive : styles.segment}
                onClick={() => patch({ isLunar: false })}
              >
                公历
              </button>
              <button
                type="button"
                className={draft.isLunar ? styles.segmentActive : styles.segment}
                onClick={() => patch({ isLunar: true })}
              >
                农历
              </button>
            </div>
          </div>
          <div className={styles.dateRow}>
            {draft.isLunar ? (
              <LunarFields value={parseLocalDate(draft.date)} onChange={setLunarDate} />
            ) : (
              <IsoDateInput
                className={styles.dateGrow}
                label="日期"
                value={draft.date}
                onChange={(next) =>
                  patch({ date: next === '' ? toISODate(todayLocalDate()) : next })
                }
              />
            )}
            <button type="button" className={styles.todayButton} onClick={() => patch({ date: toISODate(todayLocalDate()) })}>
              今天
            </button>
          </div>
          {draft.isLunar && <p className={styles.hint}>农历：{describeLunar(parseLocalDate(draft.date))}</p>}
        </div>

        <div className={styles.switchRow}>
          <span className={styles.fieldLabel}>置顶</span>
          <Toggle checked={draft.isPinned} onChange={(next) => patch({ isPinned: next })} label="置顶" />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>类型</span>
          <div className={styles.radioRow}>
            {TYPE_LABELS.map((option) => (
              <label key={option.value} className={styles.radio}>
                <input
                  type="radio"
                  name="type"
                  checked={draft.type === option.value}
                  onChange={() => setDraft((current) => applyTypeDefaults(current, option.value))}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className={styles.switchRow}>
          <div className={styles.switchText}>
            <span className={styles.fieldLabel}>个性化</span>
            <span className={styles.hint}>定制卡片颜色、字体和背景</span>
          </div>
          <Toggle checked={draft.isCustomized} onChange={(next) => patch({ isCustomized: next })} label="个性化" />
        </div>

        {draft.isCustomized && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>卡片背景图</span>
            <input
              className={styles.input}
              type="file"
              accept="image/*"
              disabled={imageBusy}
              aria-label="选择背景图"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void pickBackgroundImage(file);
              }}
            />
            {draft.cardBackgroundType === 'IMAGE' && draft.cardBackgroundImagePath !== '' ? (
              <div className={styles.inlineRow}>
                <span className={styles.hint}>当前背景图：{imageBasename(draft.cardBackgroundImagePath)}</span>
                <button
                  type="button"
                  className={styles.todayButton}
                  disabled={imageBusy}
                  onClick={() => void removeBackgroundImage()}
                >
                  移除背景图
                </button>
              </div>
            ) : (
              <span className={styles.hint}>可选，自动压到最长边 1080、JPEG 0.85；卡片与分享图都会显示</span>
            )}
            {imageBusy && <span className={styles.hint}>正在处理图片…</span>}
          </div>
        )}

        <label className={styles.field}>
          <span className={styles.fieldLabel}>标签（可选）</span>
          <input
            className={styles.input}
            value={draft.tag}
            placeholder="标签（可选）"
            list="tag-options"
            maxLength={30}
            onChange={(event) => patch({ tag: event.target.value })}
          />
          <datalist id="tag-options">
            {tags.map((tag) => (
              <option key={tag.id} value={tag.name} />
            ))}
          </datalist>
        </label>

        <div className={styles.group}>
          <button type="button" className={styles.groupRow} onClick={() => setShowRepeat((value) => !value)}>
            <span className={styles.fieldLabel}>重复</span>
            <span className={styles.groupValue}>{repeatSummary(draft, isInterval)}</span>
            <ChevronRightIcon className={`${styles.chevron} ${showRepeat ? styles.chevronOpen : ''}`} width={20} height={20} />
          </button>
          {showRepeat && (
            <div className={styles.panel}>
              <div className={styles.switchRow}>
                <span>启用重复</span>
                <Toggle
                  checked={draft.repeatInfo !== null}
                  label="启用重复"
                  onChange={(next) =>
                    patch({ repeatInfo: next ? { interval: 1, unit: 'YEAR', endDate: null } : null })
                  }
                />
              </div>
              {draft.repeatInfo !== null && (
                <>
                  <div className={styles.inlineRow}>
                    <span>间隔</span>
                    <input
                      className={styles.numberInput}
                      type="number"
                      min={1}
                      max={999}
                      value={draft.repeatInfo.interval}
                      onChange={(event) =>
                        patch({
                          repeatInfo: {
                            ...draft.repeatInfo!,
                            interval: Math.max(1, Number(event.target.value) || 1),
                          },
                        })
                      }
                    />
                    <select
                      className={styles.select}
                      value={draft.repeatInfo.unit}
                      onChange={(event) =>
                        patch({ repeatInfo: { ...draft.repeatInfo!, unit: event.target.value as RepeatUnit } })
                      }
                    >
                      {UNIT_LABELS.map((unit) => (
                        <option key={unit.value} value={unit.value}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className={styles.inlineRow}>
                    <span>截止日期</span>
                    <IsoDateInput
                      className={styles.dateGrow}
                      label="截止日期"
                      value={draft.repeatInfo.endDate ?? ''}
                      onChange={(next) =>
                        patch({
                          repeatInfo: { ...draft.repeatInfo!, endDate: next === '' ? null : next },
                        })
                      }
                    />
                  </label>
                </>
              )}
            </div>
          )}
        </div>

        {isInterval && (
          <div className={styles.switchRow}>
            <div className={styles.switchText}>
              <span className={styles.fieldLabel}>区间事件</span>
              <span className={styles.hint}>结束日当天仍属进行中</span>
            </div>
            <Toggle
              checked={draft.endDate !== null}
              label="区间事件"
              onChange={(next) => patch({ endDate: next ? draft.date : null })}
            />
          </div>
        )}
        {isInterval && draft.endDate !== null && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>结束日期</span>
            <IsoDateInput
              label="结束日期"
              value={draft.endDate}
              min={draft.date}
              onChange={(next) => patch({ endDate: next === '' ? null : next })}
            />
          </label>
        )}

        <div className={styles.group}>
          <button type="button" className={styles.groupRow} onClick={() => setShowNotifications((value) => !value)}>
            <span className={styles.fieldLabel}>提醒设置</span>
            <span className={styles.groupValue}>{notificationSummary(draft)}</span>
            <ChevronRightIcon className={`${styles.chevron} ${showNotifications ? styles.chevronOpen : ''}`} width={20} height={20} />
          </button>
          {showNotifications && (
            <div className={styles.panel}>
              <div className={styles.switchRow}>
                <span>启用提醒</span>
                <Toggle
                  checked={draft.notificationConfig.isEnabled}
                  label="启用提醒"
                  onChange={(next) =>
                    patch({ notificationConfig: { ...draft.notificationConfig, isEnabled: next } })
                  }
                />
              </div>
              <div className={styles.switchRow}>
                <span>包含当天</span>
                <Toggle
                  checked={draft.notificationConfig.includeStartDay}
                  label="包含当天"
                  onChange={(next) =>
                    patch({ notificationConfig: { ...draft.notificationConfig, includeStartDay: next } })
                  }
                />
              </div>
              <div className={styles.switchRow}>
                <span>连续提醒</span>
                <Toggle
                  checked={draft.notificationConfig.isContinuous}
                  label="连续提醒"
                  onChange={(next) =>
                    patch({ notificationConfig: { ...draft.notificationConfig, isContinuous: next } })
                  }
                />
              </div>
              <span className={styles.fieldLabel}>提醒时刻</span>
              {notificationTimes.map((time, index) => (
                <div className={styles.inlineRow} key={`${index}-${time.daysBefore}-${time.time}`}>
                  <span>提前</span>
                  <input
                    className={styles.numberInput}
                    type="number"
                    min={0}
                    value={time.daysBefore}
                    onChange={(event) => {
                      const next = notificationTimes.slice();
                      next[index] = { ...time, daysBefore: Math.max(0, Number(event.target.value) || 0) };
                      updateTimes(next);
                    }}
                  />
                  <span>天</span>
                  <input
                    className={styles.input}
                    type="time"
                    value={time.time.slice(0, 5)}
                    onChange={(event) => {
                      const next = notificationTimes.slice();
                      next[index] = { ...time, time: `${event.target.value}:00` };
                      updateTimes(next);
                    }}
                  />
                  <IconButton
                    label="移除"
                    onClick={() => updateTimes(notificationTimes.filter((_, i) => i !== index))}
                  >
                    <CloseIcon width={18} height={18} />
                  </IconButton>
                </div>
              ))}
              <button
                type="button"
                className={styles.addButton}
                onClick={() => updateTimes([...notificationTimes, { daysBefore: defaultAdvanceDays, time: '09:00:00' }])}
              >
                <PlusIcon width={18} height={18} />
                添加提醒时刻
              </button>
            </div>
          )}
        </div>

        <div className={styles.group}>
          <button type="button" className={styles.groupRow} onClick={() => setShowNotes((value) => !value)}>
            <span className={styles.fieldLabel}>备注</span>
            <span className={styles.groupValue}>{draft.notes.trim() === '' ? '点击添加备注' : '已填写'}</span>
            <ChevronRightIcon className={`${styles.chevron} ${showNotes ? styles.chevronOpen : ''}`} width={20} height={20} />
          </button>
          {showNotes && (
            <div className={styles.panel}>
              <textarea
                className={styles.textarea}
                rows={4}
                value={draft.notes}
                placeholder="备注"
                onChange={(event) => patch({ notes: event.target.value })}
              />
            </div>
          )}
        </div>

        {!isEditing && (
          <p className={styles.hint}>保存后可在详情页继续编辑。</p>
        )}
      </div>
    </div>
  );
}

function LunarFields({ value, onChange }: { value: LocalDate; onChange: (year: number, month: number, day: number) => void }) {
  const lunar = solarToLunar(value);
  const months = lunarMonthsOfYear(lunar.year);
  const currentMonth = months.find((entry) => entry.month === lunar.month) ?? months[0];
  const dayCount = currentMonth?.dayCount ?? 30;
  const years = useMemo(() => {
    const list: number[] = [];
    for (let year = 1901; year <= 2099; year += 1) list.push(year);
    return list;
  }, []);

  return (
    <div className={styles.lunarRow}>
      <select
        className={styles.select}
        value={lunar.year}
        onChange={(event) => onChange(Number(event.target.value), lunar.month, lunar.day)}
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        value={lunar.month}
        onChange={(event) => onChange(lunar.year, Number(event.target.value), lunar.day)}
      >
        {months.map((month) => (
          <option key={month.month} value={month.month}>
            {month.label}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        value={Math.min(lunar.day, dayCount)}
        onChange={(event) => onChange(lunar.year, lunar.month, Number(event.target.value))}
      >
        {Array.from({ length: dayCount }, (_, index) => index + 1).map((day) => (
          <option key={day} value={day}>
            {lunarDayLabel(lunar.year, lunar.month, day)}
          </option>
        ))}
      </select>
    </div>
  );
}

function describeLunar(value: LocalDate): string {
  const lunar = solarToLunar(value);
  return `${lunar.year}年 ${lunarMonthsOfYear(lunar.year).find((entry) => entry.month === lunar.month)?.label ?? ''}${lunarDayLabel(lunar.year, lunar.month, lunar.day)}`;
}

/**
 * 日期输入：原生 date 选择器的显示格式受浏览器 locale 影响（如 10/07/2026）。
 * 这里用自绘只读显示（固定 YYYY-MM-DD）+ 覆盖其上的透明原生选择器，
 * 既保证显示口径，又保留原生日期选择体验。
 */
function IsoDateInput({
  value,
  onChange,
  min,
  label,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  min?: string;
  label: string;
  className?: string;
}) {
  return (
    <span className={[styles.datePicker, className].filter(Boolean).join(' ')}>
      <span className={styles.dateDisplay} aria-hidden="true">
        {value === '' ? '选择日期' : value}
      </span>
      <input
        className={styles.dateNative}
        type="date"
        lang="zh-CN"
        value={value}
        min={min}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}
