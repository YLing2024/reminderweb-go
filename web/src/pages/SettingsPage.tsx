import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { argbFromHex, hexFromArgb } from '@material/material-color-utilities';
import {
  ArrowBackIcon,
  BellIcon,
  CalculatorIcon,
  CheckIcon,
  ChevronRightIcon,
  CloudIcon,
  HomeIcon,
  LockIcon,
  PaletteIcon,
  ServerIcon,
  StorageIcon,
  TagIcon,
} from '../components/icons';
import { ConfirmDialog, IconButton, Toggle } from '../components/ui';
import { AuthWarningBanner } from '../components/AuthWarningBanner';
import { PasswordField } from '../components/PasswordField';
import { ModeSettings } from '../components/ModeSettings';
import { ServerSettings } from '../components/ServerSettings';
import { WebDavSettings } from '../components/WebDavSettings';
import { SEED_PALETTES, THEME_OPTIONS } from '../lib/theme';
import { changeLockPassword, clearLockPassword, setupLockPassword } from '../lib/app-lock';
import { buildIcs } from '../lib/ics';
import { ensureLunar } from '../lib/lunar';
import { todayLocalDate } from '../lib/local-date';
import { useReminderStore } from '../store/useReminderStore';
import styles from './SettingsPage.module.css';

type DefaultPage = 'COUNTDOWN' | 'COUNTUP' | 'BIRTHDAY';

const DEFAULT_PAGE_OPTIONS: Array<{ value: DefaultPage; label: string }> = [
  { value: 'COUNTDOWN', label: '倒数日' },
  { value: 'COUNTUP', label: '正数日' },
  { value: 'BIRTHDAY', label: '生日' },
];

const SCROLL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'NONE', label: '不隐藏' },
  { value: 'HIDE_TOP_BAR', label: '隐藏标题栏' },
  { value: 'HIDE_BOTTOM_BAR', label: '隐藏底栏' },
  { value: 'HIDE_BOTH', label: '隐藏标题和底栏' },
];

const CONFIRM_WORD = '清空';

function daysSince(timestamp: number | null): number | null {
  if (timestamp === null) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const settings = useReminderStore((state) => state.settings);
  const updateSettings = useReminderStore((state) => state.updateSettings);
  const resetAll = useReminderStore((state) => state.resetAll);
  const reminders = useReminderStore((state) => state.reminders);
  const authWarning = useReminderStore((state) => state.authWarning);

  const [warningDismissed, setWarningDismissed] = useState(false);
  const [showScrollDialog, setShowScrollDialog] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showSetupLock, setShowSetupLock] = useState(false);
  const [showChangeLock, setShowChangeLock] = useState(false);
  const [verifyIntent, setVerifyIntent] = useState<'disable' | 'clear' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const customSeedHex = useMemo(
    () => hexFromArgb(settings.customColorSeed ?? argbFromHex('#6750A4')),
    [settings.customColorSeed],
  );

  const backupDays = daysSince(settings.lastBackupAt);

  const onToggleNotification = async (next: boolean) => {
    if (!next) {
      await updateSettings({ notificationEnabled: false });
      return;
    }
    if (typeof Notification === 'undefined') {
      setNotice('当前浏览器不支持系统通知，将仅在应用内提示。');
      await updateSettings({ notificationEnabled: true });
      return;
    }
    if (Notification.permission === 'granted') {
      await updateSettings({ notificationEnabled: true });
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      await updateSettings({ notificationEnabled: true });
    } else {
      setNotice('未获得通知权限，可在浏览器地址栏的站点设置里重新开启。');
    }
  };

  const exportIcs = async () => {
    await ensureLunar();
    const content = buildIcs(reminders, todayLocalDate());
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'reminder.ics';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`已导出 reminder.ics（${reminders.length} 条提醒）`);
  };

  const scrollLabel = SCROLL_OPTIONS.find((option) => option.value === settings.scrollBehavior)?.label ?? '隐藏底栏';

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <IconButton label="返回" onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <h1 className={styles.title}>设置</h1>
      </header>

      <div className={styles.content}>
        {authWarning && !warningDismissed && (
          <AuthWarningBanner onDismiss={() => setWarningDismissed(true)} />
        )}

        {notice !== null && (
          <div className={styles.notice} role="status">
            <span>{notice}</span>
            <button type="button" className={styles.noticeClose} onClick={() => setNotice(null)}>
              知道了
            </button>
          </div>
        )}

        <Group title="外观" icon={<PaletteIcon width={18} height={18} />}>
          <div className={styles.card}>
            <p className={styles.cardTitle}>主题</p>
            <Segmented
              options={THEME_OPTIONS}
              value={settings.themeOption}
              onChange={(value) => void updateSettings({ themeOption: value })}
            />
            <SwitchRow
              title="纯黑模式"
              description="深色模式下对 AMOLED 屏幕更省电"
              checked={settings.pureBlackEnabled}
              onChange={(value) => void updateSettings({ pureBlackEnabled: value })}
            />
            <SwitchRow
              title="卡片着色"
              description="基于主题色对卡片进行着色"
              checked={settings.cardColoringEnabled}
              onChange={(value) => void updateSettings({ cardColoringEnabled: value })}
            />
            <SwitchRow
              title="跟随种子色"
              description="浏览器无法读取系统壁纸，改为跟随下方种子色生成主题色"
              checked={settings.dynamicColorEnabled}
              onChange={(value) => void updateSettings({ dynamicColorEnabled: value })}
            />

            <p className={styles.subLabel}>种子色</p>
            <div className={styles.seedRow}>
              {SEED_PALETTES.map((palette) => {
                const selected = settings.dynamicColorEnabled && settings.themeColorPalette === palette.key;
                return (
                  <button
                    key={palette.key}
                    type="button"
                    className={styles.seedItem}
                    onClick={() =>
                      void updateSettings({ themeColorPalette: palette.key, dynamicColorEnabled: true })
                    }
                  >
                    <span
                      className={`${styles.seedDot} ${selected ? styles.seedDotActive : ''}`}
                      style={{ background: palette.seed }}
                    >
                      {selected && <CheckIcon width={20} height={20} style={{ color: '#fff' }} />}
                    </span>
                    <span className={selected ? styles.seedLabelActive : styles.seedLabel}>{palette.label}</span>
                  </button>
                );
              })}
              <label className={styles.seedItem}>
                <span
                  className={`${styles.seedDot} ${styles.seedCustom} ${
                    settings.dynamicColorEnabled && settings.themeColorPalette === 'CUSTOM' ? styles.seedDotActive : ''
                  }`}
                  style={{ background: customSeedHex }}
                >
                  {(settings.dynamicColorEnabled && settings.themeColorPalette === 'CUSTOM') && (
                    <CheckIcon width={20} height={20} style={{ color: '#fff' }} />
                  )}
                  <input
                    type="color"
                    className={styles.seedColorInput}
                    value={customSeedHex}
                    aria-label="自定义种子色"
                    onChange={(event) =>
                      void updateSettings({
                        themeColorPalette: 'CUSTOM',
                        customColorSeed: argbFromHex(event.target.value),
                        dynamicColorEnabled: true,
                      })
                    }
                  />
                </span>
                <span
                  className={
                    settings.dynamicColorEnabled && settings.themeColorPalette === 'CUSTOM'
                      ? styles.seedLabelActive
                      : styles.seedLabel
                  }
                >
                  自定义
                </span>
              </label>
            </div>
          </div>
        </Group>

        <Group title="首页" icon={<HomeIcon width={18} height={18} />}>
          <div className={styles.card}>
            <SwitchRow
              title="首页分类显示"
              description="开启后首页按倒数、正数、生日分类显示；关闭后所有事件统一显示"
              checked={settings.homeCategoryEnabled}
              onChange={(value) => void updateSettings({ homeCategoryEnabled: value })}
            />
            <div className={styles.subBlock}>
              <p className={styles.rowTitle}>默认起始页面</p>
              <p className={styles.rowDesc}>选择启动应用后默认显示的页面</p>
              <Segmented
                options={DEFAULT_PAGE_OPTIONS}
                value={settings.defaultPage}
                onChange={(value) => void updateSettings({ defaultPage: value })}
              />
            </div>
            <div className={styles.subBlock}>
              <p className={styles.rowTitle}>视图模式</p>
              <p className={styles.rowDesc}>首页卡片的默认排布方式</p>
              <Segmented
                options={[
                  { value: 'CARD', label: '卡片' },
                  { value: 'LIST', label: '列表' },
                ]}
                value={settings.viewMode === 'LIST' ? 'LIST' : 'CARD'}
                onChange={(value) => void updateSettings({ viewMode: value })}
              />
            </div>
            <ActionRow
              title="滚动收起策略"
              description="控制滑动时标题栏与底栏的显示行为"
              value={scrollLabel}
              onClick={() => setShowScrollDialog(true)}
            />
          </div>
        </Group>

        <Group title="提醒" icon={<BellIcon width={18} height={18} />}>
          <div className={styles.card}>
            <SwitchRow
              title="应用内通知"
              description="开启后需要浏览器通知权限，页面打开时才可送达"
              checked={settings.notificationEnabled}
              onChange={(value) => void onToggleNotification(value)}
            />
            {settings.notificationEnabled &&
              typeof Notification !== 'undefined' &&
              Notification.permission !== 'granted' && (
                <p className={styles.rowDesc}>
                  {Notification.permission === 'denied'
                    ? '通知权限已被拒绝，请到浏览器站点设置里重新允许。'
                    : '尚未授予通知权限，点击上方开关以申请。'}
                </p>
              )}
            <div className={styles.subBlock}>
              <p className={styles.rowTitle}>默认提前天数</p>
              <p className={styles.rowDesc}>新建提醒时提醒时刻的默认提前量</p>
              <div className={styles.numberRow}>
                <input
                  className={styles.numberInput}
                  type="number"
                  min={0}
                  max={365}
                  value={settings.defaultAdvanceDays}
                  onChange={(event) =>
                    void updateSettings({ defaultAdvanceDays: Math.max(0, Number(event.target.value) || 0) })
                  }
                />
                <span className={styles.numberUnit}>天</span>
              </div>
            </div>
            <div className={styles.subBlock}>
              <p className={styles.rowTitle}>提醒方式</p>
              <p className={styles.rowDesc}>
                「系统日历」在 Web 端改为导出 .ics 文件，可在系统日历中订阅或导入。
              </p>
              <Segmented
                options={[
                  { value: 'APP_NOTIFICATION', label: '应用内通知' },
                  { value: 'ICS', label: '导出 .ics' },
                ]}
                value={settings.reminderMethod}
                onChange={(value) => void updateSettings({ reminderMethod: value })}
              />
              {settings.reminderMethod === 'ICS' && (
                <ActionRow
                  title="导出 .ics 文件"
                  description="为所有提醒生成全天事件日历，可导入系统日历"
                  onClick={() => void exportIcs()}
                />
              )}
            </div>
          </div>
        </Group>

        <Group title="数据" icon={<StorageIcon width={18} height={18} />}>
          <div className={styles.card}>
            <ActionRow
              title="标签管理"
              description="管理、自定义颜色与排序分类标签"
              icon={<TagIcon width={20} height={20} />}
              onClick={() => navigate('/tags')}
            />
            <ActionRow
              title="日期计算"
              description="两个日期相差天数、目标日推算与农历换算"
              icon={<CalculatorIcon width={20} height={20} />}
              onClick={() => navigate('/calculator')}
            />
            <ActionRow
              title="备份与恢复"
              description="导入或导出与安卓互通的备份包"
              icon={<StorageIcon width={20} height={20} />}
              onClick={() => navigate('/backup')}
            />
            <div className={styles.subBlock}>
              <p className={styles.rowTitle}>备份提醒</p>
              <p className={styles.rowDesc}>
                {settings.lastBackupAt === null
                  ? '尚未备份'
                  : `上次备份：${new Date(settings.lastBackupAt).toLocaleString('zh-CN', { hour12: false })}`}
                {settings.backupReminderEnabled && backupDays !== null && ` · 已 ${backupDays} 天未备份`}
              </p>
              <SwitchRow
                title="定期提醒备份"
                description="开启后依据上次备份时间提示备份"
                checked={settings.backupReminderEnabled}
                onChange={(value) => void updateSettings({ backupReminderEnabled: value })}
              />
            </div>
            <ActionRow
              title="清空数据"
              description="删除全部提醒、标签与设置，不可撤销"
              danger
              onClick={() => setShowClearDialog(true)}
            />
          </div>
        </Group>

        <Group title="WebDAV 云备份" icon={<CloudIcon width={18} height={18} />}>
          <WebDavSettings onNotice={setNotice} />
        </Group>

        <Group title="运行模式" icon={<ServerIcon width={18} height={18} />}>
          <ModeSettings onNotice={setNotice} />
        </Group>

        <Group title="服务器" icon={<ServerIcon width={18} height={18} />}>
          <ServerSettings onNotice={setNotice} />
        </Group>

        <Group title="安全" icon={<LockIcon width={18} height={18} />}>
          <div className={styles.card}>
            <SwitchRow
              title="应用锁"
              description="开启后离开页面再回来需输入应用锁密码"
              checked={settings.appLockEnabled}
              onChange={(value) => {
                if (value) {
                  if (settings.appLockPasswordHash === null) setShowSetupLock(true);
                  else void updateSettings({ appLockEnabled: true });
                } else {
                  setVerifyIntent('disable');
                }
              }}
            />
            {settings.appLockEnabled && settings.appLockPasswordHash !== null && (
              <>
                <ActionRow
                  title="修改密码"
                  description="重新设置应用锁密码（需先验证当前密码）"
                  onClick={() => setShowChangeLock(true)}
                />
                <ActionRow
                  title="清除应用锁"
                  description="删除本机保存的应用锁密码，需验证当前密码"
                  danger
                  onClick={() => setVerifyIntent('clear')}
                />
              </>
            )}
          </div>
        </Group>

        <Group title="关于" icon={<ChevronRightIcon width={18} height={18} />}>
          <div className={styles.card}>
            <ActionRow title="关于 ReminderWeb" description="版本与开源许可" onClick={() => navigate('/about')} />
          </div>
        </Group>
      </div>

      {showScrollDialog && (
        <ChoiceDialog
          title="首页滑动模式"
          options={SCROLL_OPTIONS}
          value={settings.scrollBehavior}
          onSelect={(value) => void updateSettings({ scrollBehavior: value })}
          onClose={() => setShowScrollDialog(false)}
        />
      )}

      {showSetupLock && (
        <PasswordSetupDialog
          onClose={() => setShowSetupLock(false)}
          onSave={async (password, confirm) => {
            const result = await setupLockPassword(password, confirm);
            if (!result.ok) return result.error;
            await updateSettings({ appLockPasswordHash: result.credential, appLockEnabled: true });
            setShowSetupLock(false);
            setNotice('应用锁已开启');
            return null;
          }}
        />
      )}

      {showChangeLock && settings.appLockPasswordHash !== null && (
        <PasswordChangeDialog
          onClose={() => setShowChangeLock(false)}
          onChange={async (current, next, confirm) => {
            const stored = settings.appLockPasswordHash!;
            const result = await changeLockPassword(current, next, confirm, stored);
            if (!result.ok) return result.error;
            await updateSettings({ appLockPasswordHash: result.credential });
            setShowChangeLock(false);
            setNotice('应用锁密码已更新');
            return null;
          }}
        />
      )}

      {verifyIntent !== null && settings.appLockPasswordHash !== null && (
        <PasswordVerifyDialog
          title={verifyIntent === 'clear' ? '清除应用锁' : '关闭应用锁'}
          description={
            verifyIntent === 'clear'
              ? '清除后需重新设置密码才能再次开启应用锁。'
              : '关闭应用锁前需验证当前密码。'
          }
          onClose={() => setVerifyIntent(null)}
          onVerify={async (password) => {
            const intent = verifyIntent;
            const stored = settings.appLockPasswordHash!;
            const ok = await clearLockPassword(password, stored);
            if (ok) {
              if (intent === 'clear') {
                await updateSettings({ appLockPasswordHash: null, appLockEnabled: false });
                setNotice('已清除应用锁');
              } else {
                await updateSettings({ appLockEnabled: false });
                setNotice('已关闭应用锁');
              }
              setVerifyIntent(null);
            }
            return ok;
          }}
        />
      )}

      <ConfirmDialog
        open={showClearDialog}
        title="清空全部数据"
        message={`将删除全部提醒、标签与设置，此操作不可撤销。请输入「${CONFIRM_WORD}」以确认。`}
        confirmText="确认清空"
        danger
        requireText={CONFIRM_WORD}
        onCancel={() => setShowClearDialog(false)}
        onConfirm={() => {
          void resetAll();
          setShowClearDialog(false);
        }}
      />
    </div>
  );
}

function Group({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={styles.group}>
      <h2 className={styles.groupTitle}>
        {icon}
        {title}
      </h2>
      <div className={styles.groupDivider} />
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmented} role="group">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={active ? styles.segmentActive : styles.segment}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SwitchRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className={styles.switchRow}>
      <div className={styles.rowText}>
        <p className={styles.rowTitle}>{title}</p>
        {description !== undefined && <p className={styles.rowDesc}>{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

function ActionRow({
  title,
  description,
  value,
  icon,
  danger = false,
  onClick,
}: {
  title: string;
  description?: string;
  value?: string;
  icon?: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.actionRow} onClick={onClick}>
      {icon !== undefined && <span className={styles.actionIcon}>{icon}</span>}
      <span className={styles.rowText}>
        <span className={danger ? styles.rowTitleDanger : styles.rowTitle}>{title}</span>
        {description !== undefined && <span className={styles.rowDesc}>{description}</span>}
      </span>
      {value !== undefined && <span className={styles.actionValue}>{value}</span>}
      <ChevronRightIcon width={20} height={20} className={styles.chevron} />
    </button>
  );
}

function ChoiceDialog({
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  title: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.dialogBackdrop} role="presentation" onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.dialogTitle}>{title}</h2>
        <div className={styles.choiceList}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.choice}
              onClick={() => {
                onSelect(option.value);
                onClose();
              }}
            >
              <span className={option.value === value ? styles.radioOn : styles.radioOff} />
              {option.label}
            </button>
          ))}
        </div>
        <div className={styles.dialogActions}>
          <button type="button" className={styles.textButton} onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

const WEAK_PASSWORD_HINT = '建议至少 6 位，混合字母与符号';

function PasswordSetupDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (password: string, confirm: string) => Promise<string | null>;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canSubmit = password.length > 0 && confirm.length > 0 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const message = await onSave(password, confirm);
    setSaving(false);
    if (message !== null) setError(message);
  };

  return (
    <div className={styles.dialogBackdrop} role="presentation" onClick={onClose}>
      <form
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="设置应用锁密码"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className={styles.dialogTitle}>设置应用锁密码</h2>
        <PasswordField
          label="密码"
          value={password}
          visible={passwordVisible}
          onChange={(value) => {
            setError(null);
            setPassword(value);
          }}
          onToggleVisible={() => setPasswordVisible((current) => !current)}
          autoComplete="new-password"
          autoFocus
          placeholder="任意字符，1–128 位"
          ariaLabel="新密码"
        />
        <p className={styles.passwordHint}>{WEAK_PASSWORD_HINT}</p>
        <PasswordField
          label="再次输入"
          value={confirm}
          visible={confirmVisible}
          onChange={(value) => {
            setError(null);
            setConfirm(value);
          }}
          onToggleVisible={() => setConfirmVisible((current) => !current)}
          autoComplete="new-password"
          ariaLabel="确认新密码"
        />
        {error !== null && <p className={styles.dialogError}>{error}</p>}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.textButton} onClick={onClose}>
            取消
          </button>
          <button type="submit" className={`${styles.textButton} ${styles.textButtonPrimary}`} disabled={!canSubmit}>
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function PasswordChangeDialog({
  onClose,
  onChange,
}: {
  onClose: () => void;
  onChange: (current: string, next: string, confirm: string) => Promise<string | null>;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currentVisible, setCurrentVisible] = useState(false);
  const [nextVisible, setNextVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canSubmit = current.length > 0 && next.length > 0 && confirm.length > 0 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const message = await onChange(current, next, confirm);
    setSaving(false);
    if (message !== null) setError(message);
  };

  return (
    <div className={styles.dialogBackdrop} role="presentation" onClick={onClose}>
      <form
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="修改应用锁密码"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className={styles.dialogTitle}>修改应用锁密码</h2>
        <PasswordField
          label="当前密码"
          value={current}
          visible={currentVisible}
          onChange={(value) => {
            setError(null);
            setCurrent(value);
          }}
          onToggleVisible={() => setCurrentVisible((value) => !value)}
          autoComplete="current-password"
          autoFocus
          ariaLabel="当前密码"
        />
        <PasswordField
          label="新密码"
          value={next}
          visible={nextVisible}
          onChange={(value) => {
            setError(null);
            setNext(value);
          }}
          onToggleVisible={() => setNextVisible((value) => !value)}
          autoComplete="new-password"
          placeholder="任意字符，1–128 位"
          ariaLabel="新密码"
        />
        <p className={styles.passwordHint}>{WEAK_PASSWORD_HINT}</p>
        <PasswordField
          label="再次输入新密码"
          value={confirm}
          visible={confirmVisible}
          onChange={(value) => {
            setError(null);
            setConfirm(value);
          }}
          onToggleVisible={() => setConfirmVisible((value) => !value)}
          autoComplete="new-password"
          ariaLabel="确认新密码"
        />
        {error !== null && <p className={styles.dialogError}>{error}</p>}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.textButton} onClick={onClose}>
            取消
          </button>
          <button type="submit" className={`${styles.textButton} ${styles.textButtonPrimary}`} disabled={!canSubmit}>
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function PasswordVerifyDialog({
  title,
  description,
  onClose,
  onVerify,
}: {
  title: string;
  description: string;
  onClose: () => void;
  onVerify: (password: string) => Promise<boolean>;
}) {
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    if (password.length === 0 || checking) return;
    setChecking(true);
    const ok = await onVerify(password);
    setChecking(false);
    if (!ok) setError(true);
  };

  return (
    <div className={styles.dialogBackdrop} role="presentation" onClick={onClose}>
      <form
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className={styles.dialogTitle}>{title}</h2>
        <p className={styles.rowDesc}>{description}</p>
        <PasswordField
          value={password}
          visible={visible}
          onChange={(value) => {
            setError(false);
            setPassword(value);
          }}
          onToggleVisible={() => setVisible((current) => !current)}
          autoComplete="current-password"
          autoFocus
          ariaLabel="当前密码"
        />
        {error && <p className={styles.dialogError}>密码不正确</p>}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.textButton} onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className={`${styles.textButton} ${styles.textButtonPrimary}`}
            disabled={password.length === 0 || checking}
          >
            确认
          </button>
        </div>
      </form>
    </div>
  );
}
