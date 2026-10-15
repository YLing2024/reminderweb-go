import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReminderCard } from '../components/ReminderCard';
import { SectionHeader } from '../components/SectionHeader';
import { HomeNav, type HomeCategory } from '../components/HomeNav';
import { ThemeToggle } from '../components/ThemeToggle';
import { ConfirmDialog, IconButton, MenuOverlay, type MenuItem } from '../components/ui';
import { GridIcon, ListIcon, PinIcon, PlusIcon, SearchIcon, SettingsIcon, EditIcon, DeleteIcon } from '../components/icons';
import { buildReminderSections } from '../lib/sort';
import { reminderDisplayInfo } from '../lib/display';
import { todayLocalDate } from '../lib/local-date';
import { ensureLunar } from '../lib/lunar';
import { useLunarReady } from '../lib/useLunarReady';
import { useReminderStore } from '../store/useReminderStore';
import type { ReminderItem } from '../types/reminder';
import styles from './HomePage.module.css';

const CATEGORY_FROM_DEFAULT: Record<string, HomeCategory> = {
  COUNTDOWN: 'COUNTDOWN',
  COUNTUP: 'COUNTUP',
  BIRTHDAY: 'BIRTHDAY',
};

function categoryToType(category: HomeCategory): 'ANNUAL' | 'COUNT_UP' | 'BIRTHDAY' {
  switch (category) {
    case 'COUNTDOWN':
      return 'ANNUAL';
    case 'COUNTUP':
      return 'COUNT_UP';
    case 'BIRTHDAY':
      return 'BIRTHDAY';
  }
}

export default function HomePage() {
  const navigate = useNavigate();
  const reminders = useReminderStore((state) => state.reminders);
  const tags = useReminderStore((state) => state.tags);
  const settings = useReminderStore((state) => state.settings);
  const loaded = useReminderStore((state) => state.loaded);
  const hydrate = useReminderStore((state) => state.hydrate);
  const togglePin = useReminderStore((state) => state.togglePin);
  const deleteReminder = useReminderStore((state) => state.deleteReminder);
  const updateSettings = useReminderStore((state) => state.updateSettings);

  useEffect(() => {
    if (!loaded) void hydrate();
  }, [loaded, hydrate]);

  const [category, setCategory] = useState<HomeCategory>(
    CATEGORY_FROM_DEFAULT[settings.defaultPage] ?? 'COUNTDOWN',
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menuItem, setMenuItem] = useState<ReminderItem | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReminderItem | null>(null);
  const [navHidden, setNavHidden] = useState(false);
  const [topHidden, setTopHidden] = useState(false);
  const lastScroll = useRef(0);

  const today = todayLocalDate();
  const categoryEnabled = settings.homeCategoryEnabled;
  const viewMode = settings.viewMode;
  const hidesTop = settings.scrollBehavior === 'HIDE_TOP_BAR' || settings.scrollBehavior === 'HIDE_BOTH';
  const hidesBottom = settings.scrollBehavior === 'HIDE_BOTTOM_BAR' || settings.scrollBehavior === 'HIDE_BOTH';

  useEffect(() => {
    if (settings.scrollBehavior === 'NONE') {
      setNavHidden(false);
      setTopHidden(false);
      return;
    }
    const onScroll = () => {
      const y = window.scrollY;
      if (y > lastScroll.current + 8 && y > 80) {
        if (hidesBottom) setNavHidden(true);
        if (hidesTop) setTopHidden(true);
      } else if (y < lastScroll.current - 8) {
        setNavHidden(false);
        setTopHidden(false);
      }
      lastScroll.current = y;
    };
    lastScroll.current = window.scrollY;
    setNavHidden(false);
    setTopHidden(false);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [settings.scrollBehavior, hidesBottom, hidesTop]);

  const visibleItems = useMemo(() => {
    if (!categoryEnabled) return reminders;
    const type = categoryToType(category);
    return reminders.filter((item) => item.type === type);
  }, [reminders, category, categoryEnabled]);

  // 首屏不静态引入农历表：仅当可见条目里确有农历事件时才按需载入。
  const needsLunar = useMemo(() => visibleItems.some((item) => item.isLunar), [visibleItems]);
  const lunarReady = useLunarReady();
  useEffect(() => {
    if (needsLunar) void ensureLunar();
  }, [needsLunar]);
  const lunarPending = needsLunar && !lunarReady;

  const sections = useMemo(
    () => (lunarPending ? [] : buildReminderSections(visibleItems, tags, today)),
    [visibleItems, tags, today, lunarPending],
  );

  const tagColorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const tag of tags) map.set(tag.name.trim().toLowerCase(), tag.color);
    return map;
  }, [tags]);

  const toggleSection = useCallback((key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const openMenu = (item: ReminderItem, point: { x: number; y: number } | null) => {
    setMenuItem(item);
    setMenuAnchor(point);
  };

  const menuItems: MenuItem[] =
    menuItem === null
      ? []
      : [
          {
            key: 'pin',
            label: menuItem.isPinned ? '取消置顶' : '置顶',
            icon: <PinIcon width={20} height={20} />,
            onSelect: () => {
              void togglePin(menuItem.id);
            },
          },
          {
            key: 'edit',
            label: '编辑',
            icon: <EditIcon width={20} height={20} />,
            onSelect: () => navigate(`/reminder/${menuItem.id}/edit`),
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            icon: <DeleteIcon width={20} height={20} />,
            onSelect: () => setPendingDelete(menuItem),
          },
        ];

  return (
    <div className={styles.page}>
      <HomeNav category={category} onChange={setCategory} hidden={navHidden || !categoryEnabled} />

      <div className={styles.content}>
        <header className={`${styles.topBar} ${topHidden ? styles.topBarHidden : ''}`}>
          <span className={styles.wordmark}>Reminder</span>
          <div className={styles.topActions}>
            <ThemeToggle />
            <div className={styles.viewSwitch} role="group" aria-label="视图切换">
              <button
                type="button"
                className={viewMode === 'CARD' ? styles.viewSwitchActive : styles.viewSwitchButton}
                aria-pressed={viewMode === 'CARD'}
                title="卡片视图"
                onClick={() => void updateSettings({ viewMode: 'CARD' })}
              >
                <GridIcon width={20} height={20} />
              </button>
              <button
                type="button"
                className={viewMode === 'LIST' ? styles.viewSwitchActive : styles.viewSwitchButton}
                aria-pressed={viewMode === 'LIST'}
                title="列表视图"
                onClick={() => void updateSettings({ viewMode: 'LIST' })}
              >
                <ListIcon width={20} height={20} />
              </button>
            </div>
            <IconButton label="搜索" onClick={() => navigate('/search')}>
              <SearchIcon />
            </IconButton>
            <IconButton label="设置" onClick={() => navigate('/settings')}>
              <SettingsIcon />
            </IconButton>
          </div>
        </header>

        {(!loaded || lunarPending) && <p className={styles.status}>正在载入…</p>}

        {loaded && !lunarPending && visibleItems.length === 0 && (
          <div className={styles.empty}>
            <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
              <rect x="24" y="20" width="72" height="80" rx="12" fill="var(--app-tint-strong)" />
              <rect x="36" y="40" width="48" height="10" rx="5" fill="var(--md-sys-color-primary)" opacity="0.5" />
              <rect x="44" y="58" width="32" height="26" rx="6" fill="var(--md-sys-color-primary)" opacity="0.35" />
            </svg>
            <p className={styles.emptyText}>还没有提醒</p>
            <button type="button" className={styles.primaryButton} onClick={() => navigate('/reminder/new')}>
              新增提醒
            </button>
          </div>
        )}

        {loaded && !lunarPending && visibleItems.length > 0 && (
          <div className={styles.sections}>
            {sections.map((section) => {
              const variant = section.key === 'pinned' ? 'pinned' : section.tagColorHex === null && section.title === '无标签' ? 'uncategorized' : 'tag';
              const isCollapsed = collapsed.has(section.key);
              return (
                <section key={section.key} className={styles.section}>
                  <SectionHeader
                    title={section.title}
                    count={section.items.length}
                    color={section.tagColorHex}
                    variant={variant}
                    collapsed={isCollapsed}
                    onToggle={() => toggleSection(section.key)}
                  />
                  {!isCollapsed &&
                    (viewMode === 'LIST' ? (
                      <ul className={styles.list}>
                        {section.items.map((item) => {
                          const info = reminderDisplayInfo(item, today);
                          const itemTagColor = tagColorByName.get(item.tag.trim().toLowerCase()) ?? null;
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                className={styles.listRow}
                                onClick={() => navigate(`/reminder/${item.id}`)}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  openMenu(item, { x: event.clientX, y: event.clientY });
                                }}
                              >
                                <span
                                  className={styles.listDot}
                                  style={{ background: itemTagColor ?? 'var(--md-sys-color-primary)' }}
                                />
                                <span className={styles.listTitle}>{info.headerTitle}</span>
                                <span className={styles.listDays}>{info.isToday ? '今' : info.dayCount} 天</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div className={styles.grid}>
                        {section.items.map((item) => (
                          <ReminderCard
                            key={item.id}
                            item={item}
                            today={today}
                            tagColor={tagColorByName.get(item.tag.trim().toLowerCase()) ?? null}
                            onOpen={() => navigate(`/reminder/${item.id}`)}
                            onRequestMenu={(point) => openMenu(item, point)}
                          />
                        ))}
                      </div>
                    ))}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {loaded && visibleItems.length > 0 && (
        <>
          <button
            type="button"
            className={`${styles.fab} ${styles.fabLeft}`}
            aria-label={viewMode === 'CARD' ? '切换为列表' : '切换为卡片'}
            title={viewMode === 'CARD' ? '切换为列表' : '切换为卡片'}
            onClick={() => void updateSettings({ viewMode: viewMode === 'CARD' ? 'LIST' : 'CARD' })}
          >
            {viewMode === 'CARD' ? <ListIcon /> : <GridIcon />}
          </button>
          <button
            type="button"
            className={`${styles.fab} ${styles.fabRight}`}
            aria-label="新增提醒"
            title="新增提醒"
            onClick={() => navigate('/reminder/new')}
          >
            <PlusIcon />
          </button>
        </>
      )}

      <MenuOverlay open={menuItem !== null} items={menuItems} onClose={() => setMenuItem(null)} anchor={menuAnchor} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除提醒"
        message={pendingDelete === null ? '' : `确定删除「${pendingDelete.title}」吗？此操作不可撤销。`}
        confirmText="删除"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete !== null) void deleteReminder(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
