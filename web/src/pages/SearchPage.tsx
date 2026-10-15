import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowBackIcon, CalendarIcon, CheckIcon, CloseIcon, SearchIcon, TagIcon } from '../components/icons';
import { IconButton } from '../components/ui';
import { reminderDisplayInfo } from '../lib/display';
import { todayLocalDate } from '../lib/local-date';
import { EMPTY_CRITERIA, filterReminders, hasActiveCriteria, type SearchCriteria } from '../lib/search';
import { useReminderStore } from '../store/useReminderStore';
import type { ReminderType } from '../types/reminder';
import styles from './SearchPage.module.css';

const TYPE_OPTIONS: Array<{ value: ReminderType; label: string }> = [
  { value: 'ANNUAL', label: '倒数日' },
  { value: 'COUNT_UP', label: '正数日' },
  { value: 'BIRTHDAY', label: '生日' },
];

const TYPE_LABEL: Record<ReminderType, string> = {
  ANNUAL: '倒数日',
  COUNT_UP: '正数日',
  BIRTHDAY: '生日',
};

export default function SearchPage() {
  const navigate = useNavigate();
  const reminders = useReminderStore((state) => state.reminders);
  const tags = useReminderStore((state) => state.tags);
  const loaded = useReminderStore((state) => state.loaded);
  const hydrate = useReminderStore((state) => state.hydrate);

  useEffect(() => {
    if (!loaded) void hydrate();
  }, [loaded, hydrate]);

  const [criteria, setCriteria] = useState<SearchCriteria>({ ...EMPTY_CRITERIA });
  const [showFilters, setShowFilters] = useState(false);
  const [showDate, setShowDate] = useState(false);

  const today = todayLocalDate();
  const results = useMemo(() => filterReminders(reminders, criteria, today), [reminders, criteria, today]);
  const active = hasActiveCriteria(criteria);

  const sortedTags = useMemo(() => [...tags].sort((a, b) => a.sortOrder - b.sortOrder), [tags]);
  const tagColorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const tag of tags) map.set(tag.name.trim().toLowerCase(), tag.color);
    return map;
  }, [tags]);

  const patch = (partial: Partial<SearchCriteria>) => setCriteria((current) => ({ ...current, ...partial }));

  const toggleType = (type: ReminderType) =>
    patch({ types: criteria.types.includes(type) ? criteria.types.filter((t) => t !== type) : [...criteria.types, type] });

  const toggleTag = (name: string) =>
    patch({ tags: criteria.tags.includes(name) ? criteria.tags.filter((t) => t !== name) : [...criteria.tags, name] });

  const totalSelected = criteria.types.length + criteria.tags.length;
  const filterChipText =
    totalSelected === 0
      ? '类型与标签'
      : totalSelected === 1
        ? criteria.types.length === 1
          ? TYPE_LABEL[criteria.types[0]!]
          : criteria.tags[0] === ''
            ? '无标签'
            : (criteria.tags[0] ?? '')
        : `已选 ${totalSelected} 项`;

  const dateChipText =
    criteria.dateFrom !== null || criteria.dateTo !== null
      ? `${criteria.dateFrom ?? '不限'} 至 ${criteria.dateTo ?? '不限'}`
      : '选择日期';

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <IconButton label="返回" onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <div className={styles.searchField}>
          <SearchIcon width={20} height={20} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={criteria.query}
            placeholder="搜索标题、备注或标签…"
            aria-label="搜索"
            autoFocus
            onChange={(event) => patch({ query: event.target.value })}
          />
          {criteria.query !== '' && (
            <IconButton label="清空" onClick={() => patch({ query: '' })}>
              <CloseIcon width={18} height={18} />
            </IconButton>
          )}
        </div>
      </header>

      <div className={styles.content}>
        <div className={styles.chips}>
          <button
            type="button"
            className={`${styles.chip} ${totalSelected > 0 ? styles.chipActive : ''}`}
            onClick={() => {
              setShowFilters((value) => !value);
              setShowDate(false);
            }}
            aria-expanded={showFilters}
          >
            <TagIcon width={18} height={18} />
            <span>{filterChipText}</span>
            {totalSelected > 0 ? (
              <span
                className={styles.chipClear}
                role="button"
                aria-label="清除类型与标签筛选"
                onClick={(event) => {
                  event.stopPropagation();
                  patch({ types: [], tags: [] });
                }}
              >
                <CloseIcon width={14} height={14} />
              </span>
            ) : (
              <span className={styles.chipCaret}>▾</span>
            )}
          </button>

          <button
            type="button"
            className={`${styles.chip} ${criteria.dateFrom !== null || criteria.dateTo !== null ? styles.chipActive : ''}`}
            onClick={() => {
              setShowDate((value) => !value);
              setShowFilters(false);
            }}
            aria-expanded={showDate}
          >
            <CalendarIcon width={18} height={18} />
            <span>{dateChipText}</span>
            {(criteria.dateFrom !== null || criteria.dateTo !== null) && (
              <span
                className={styles.chipClear}
                role="button"
                aria-label="清除日期筛选"
                onClick={(event) => {
                  event.stopPropagation();
                  patch({ dateFrom: null, dateTo: null });
                }}
              >
                <CloseIcon width={14} height={14} />
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className={styles.panel}>
            <p className={styles.panelLabel}>类型</p>
            <div className={styles.optionWrap}>
              {TYPE_OPTIONS.map((option) => {
                const selected = criteria.types.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`${styles.option} ${selected ? styles.optionActive : ''}`}
                    onClick={() => toggleType(option.value)}
                  >
                    {selected && <CheckIcon width={16} height={16} />}
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className={styles.panelDivider} />

            <p className={styles.panelLabel}>标签</p>
            <div className={styles.optionWrap}>
              <button
                type="button"
                className={`${styles.option} ${criteria.tags.includes('') ? styles.optionActive : ''}`}
                onClick={() => toggleTag('')}
              >
                {criteria.tags.includes('') && <CheckIcon width={16} height={16} />}
                <span className={styles.dot} style={{ background: 'var(--neutral-badge)' }} />
                无标签
              </button>
              {sortedTags.map((tag) => {
                const selected = criteria.tags.includes(tag.name);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={`${styles.option} ${selected ? styles.optionActive : ''}`}
                    onClick={() => toggleTag(tag.name)}
                  >
                    {selected && <CheckIcon width={16} height={16} />}
                    <span className={styles.dot} style={{ background: tag.color }} />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {showDate && (
          <div className={styles.panel}>
            <p className={styles.panelLabel}>时间范围</p>
            <div className={styles.dateRow}>
              <label className={styles.dateField}>
                <span>开始</span>
                <input
                  type="date"
                  lang="zh-CN"
                  value={criteria.dateFrom ?? ''}
                  onChange={(event) => patch({ dateFrom: event.target.value === '' ? null : event.target.value })}
                />
              </label>
              <span className={styles.dateSep}>至</span>
              <label className={styles.dateField}>
                <span>结束</span>
                <input
                  type="date"
                  lang="zh-CN"
                  value={criteria.dateTo ?? ''}
                  onChange={(event) => patch({ dateTo: event.target.value === '' ? null : event.target.value })}
                />
              </label>
            </div>
            <p className={styles.panelHint}>留空一端表示不限；对倒数日与生日，同时也按下一次目标日匹配。</p>
          </div>
        )}

        {!loaded && <p className={styles.status}>正在载入…</p>}

        {loaded && !active && (
          <div className={styles.empty}>
            <SearchIcon width={64} height={64} className={styles.emptyIcon} />
            <p className={styles.emptyText}>输入标题或选择筛选条件进行搜索</p>
          </div>
        )}

        {loaded && active && results.length === 0 && (
          <div className={styles.empty}>
            <SearchIcon width={64} height={64} className={styles.emptyIcon} />
            <p className={styles.emptyText}>没有找到匹配的提醒</p>
            <p className={styles.emptyHint}>试试更换关键词或放宽筛选条件</p>
          </div>
        )}

        {loaded && results.length > 0 && (
          <ul className={styles.results}>
            {results.map((item) => {
              const info = reminderDisplayInfo(item, today);
              const tagColor = tagColorByName.get(item.tag.trim().toLowerCase()) ?? null;
              return (
                <li key={item.id}>
                  <button type="button" className={styles.row} onClick={() => navigate(`/reminder/${item.id}`)}>
                    <span
                      className={styles.rowDot}
                      style={{ background: tagColor ?? `var(--type-${item.type === 'COUNT_UP' ? 'count-up' : item.type === 'BIRTHDAY' ? 'birthday' : 'annual'})` }}
                    />
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>{item.title}</span>
                      <span className={styles.rowMeta}>
                        {TYPE_LABEL[item.type]}
                        {item.tag.trim() !== '' && ` · ${item.tag.trim()}`}
                        {item.notes.trim() !== '' && ` · ${item.notes.trim()}`}
                      </span>
                    </span>
                    <span className={styles.rowDays}>{info.isToday ? '今天' : `${info.dayCount} 天`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
