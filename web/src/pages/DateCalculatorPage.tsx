import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowBackIcon } from '../components/icons';
import { IconButton } from '../components/ui';
import { lunarDayLabel, lunarDisplay, lunarMonthsOfYear, lunarToSolar, solarToLunar } from '../lib/lunar';
import {
  daysBetween,
  isAfter,
  plusDays,
  plusMonths,
  plusYears,
  toISODate,
  todayLocalDate,
  type LocalDate,
} from '../lib/local-date';
import styles from './DateCalculatorPage.module.css';

type Mode = 'INTERVAL' | 'OFFSET' | 'LUNAR';

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'INTERVAL', label: '日期间隔' },
  { value: 'OFFSET', label: '目标日推算' },
  { value: 'LUNAR', label: '农历换算' },
];

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: LocalDate;
  onChange: (next: LocalDate) => void;
}) {
  const iso = toISODate(value);
  return (
    <label className={styles.dateField}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.datePicker}>
        <span className={styles.dateDisplay}>{iso}</span>
        <input
          className={styles.dateNative}
          type="date"
          lang="zh-CN"
          value={iso}
          aria-label={label}
          onChange={(event) => {
            const parts = event.target.value.split('-');
            if (parts.length === 3) {
              onChange({ year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) });
            }
          }}
        />
      </span>
    </label>
  );
}

export default function DateCalculatorPage() {
  const navigate = useNavigate();
  const today = todayLocalDate();
  const [mode, setMode] = useState<Mode>('INTERVAL');

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <IconButton label="返回" onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <h1 className={styles.title}>日期计算</h1>
      </header>

      <div className={styles.content}>
        <div className={styles.segmented} role="group" aria-label="计算模式">
          {MODES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={mode === item.value ? styles.segmentActive : styles.segment}
              aria-pressed={mode === item.value}
              onClick={() => setMode(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {mode === 'INTERVAL' && <IntervalMode today={today} />}
        {mode === 'OFFSET' && <OffsetMode today={today} />}
        {mode === 'LUNAR' && <LunarMode today={today} />}
      </div>
    </div>
  );
}

function IntervalMode({ today }: { today: LocalDate }) {
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);

  const ordered = !isAfter(start, end);
  const from = ordered ? start : end;
  const to = ordered ? end : start;
  const totalDays = daysBetween(from, to);
  const weeks = Math.floor(totalDays / 7);
  const weeksRemDays = totalDays % 7;

  const breakdown = useMemo(() => {
    let cursor = from;
    let years = 0;
    while (!isAfter(plusYears(cursor, 1), to)) {
      cursor = plusYears(cursor, 1);
      years += 1;
    }
    let months = 0;
    while (!isAfter(plusMonths(cursor, 1), to)) {
      cursor = plusMonths(cursor, 1);
      months += 1;
    }
    const days = daysBetween(cursor, to);
    return { years, months, days };
  }, [from, to]);

  return (
    <div className={styles.stack}>
      <div className={styles.card}>
        <DateInput label="开始日期" value={start} onChange={setStart} />
        <div className={styles.swapRow}>
          <button
            type="button"
            className={styles.swapButton}
            aria-label="交换日期"
            onClick={() => {
              setStart(end);
              setEnd(start);
            }}
          >
            ⇅
          </button>
        </div>
        <DateInput label="结束日期" value={end} onChange={setEnd} />
      </div>

      <ResultCard
        headline={`${totalDays} 天`}
        subline={buildBreakdown(breakdown, weeks, weeksRemDays)}
        badge={ordered ? null : '已自动按先后顺序计算'}
      />
    </div>
  );
}

function buildBreakdown(
  ym: { years: number; months: number; days: number },
  weeks: number,
  weeksRemDays: number,
): string {
  const parts: string[] = [];
  if (ym.years > 0) parts.push(`${ym.years}年${ym.months > 0 ? `${ym.months}月` : ''}${ym.days > 0 ? `${ym.days}天` : ''}`);
  else if (ym.months > 0) parts.push(`${ym.months}月${ym.days > 0 ? `${ym.days}天` : ''}`);
  else if (ym.days > 0) parts.push(`${ym.days}天`);
  if (weeks > 0) parts.push(`${weeks}周${weeksRemDays > 0 ? `${weeksRemDays}天` : ''}`);
  return parts.join(' · ');
}

function OffsetMode({ today }: { today: LocalDate }) {
  const [base, setBase] = useState(today);
  const [forward, setForward] = useState(true);
  const [daysText, setDaysText] = useState('0');
  const days = Math.min(99999, Number(daysText) || 0);
  const target = plusDays(base, forward ? days : -days);
  const diff = daysBetween(today, target);

  return (
    <div className={styles.stack}>
      <div className={styles.card}>
        <DateInput label="基准日期" value={base} onChange={setBase} />
        <div className={styles.quickRow}>
          <QuickChip label="今天" onClick={() => setBase(today)} />
          <QuickChip label="昨天" onClick={() => setBase(plusDays(today, -1))} />
          <QuickChip label="明天" onClick={() => setBase(plusDays(today, 1))} />
        </div>

        <div className={styles.offsetRow}>
          <div className={styles.directionGroup} role="group" aria-label="推算方向">
            <button
              type="button"
              className={!forward ? styles.segmentActive : styles.segment}
              onClick={() => setForward(false)}
            >
              向前
            </button>
            <button
              type="button"
              className={forward ? styles.segmentActive : styles.segment}
              onClick={() => setForward(true)}
            >
              向后
            </button>
          </div>
          <label className={styles.numberField}>
            <span className={styles.fieldLabel}>推算天数</span>
            <span className={styles.numberWrap}>
              <input
                className={styles.numberInput}
                type="number"
                min={0}
                max={99999}
                value={daysText}
                onChange={(event) => setDaysText(event.target.value.replace(/\D/g, '').slice(0, 5))}
              />
              <span className={styles.numberUnit}>天</span>
            </span>
          </label>
        </div>
        <div className={styles.quickRow}>
          {[1, 7, 30, 90, 180, 365].map((n) => (
            <QuickChip
              key={n}
              label={`${forward ? '+' : '-'}${n} 天`}
              onClick={() => setDaysText(String(n))}
            />
          ))}
        </div>
      </div>

      <ResultCard
        headline={toISODate(target)}
        subline={`${lunarDisplay(target).ganZhi}(${lunarDisplay(target).year}) ${lunarDisplay(target).monthLabel}${lunarDisplay(target).dayLabel}`}
        badge={diff === 0 ? '今天' : diff > 0 ? `距今还有 ${diff} 天` : `距今已过 ${-diff} 天`}
      />
    </div>
  );
}

function LunarMode({ today }: { today: LocalDate }) {
  const [solar, setSolar] = useState(today);
  const lunar = solarToLunar(solar);
  const [lunarYear, setLunarYear] = useState(lunar.year);
  const [lunarMonth, setLunarMonth] = useState(lunar.month);
  const [lunarDay, setLunarDay] = useState(lunar.day);

  const months = lunarMonthsOfYear(lunarYear);
  const currentMonth = months.find((month) => month.month === lunarMonth) ?? months[0];
  const dayCount = currentMonth?.dayCount ?? 30;
  const safeLunarDay = Math.min(lunarDay, dayCount);
  const converted = lunarToSolar({ year: lunarYear, month: lunarMonth, day: safeLunarDay });

  const years = useMemo(() => {
    const list: number[] = [];
    for (let year = 1901; year <= 2099; year += 1) list.push(year);
    return list;
  }, []);

  return (
    <div className={styles.stack}>
      <div className={styles.card}>
        <p className={styles.sectionTitle}>公历转农历</p>
        <DateInput label="公历日期" value={solar} onChange={setSolar} />
        <ResultRow
          label="农历"
          value={`${lunarDisplay(solar).ganZhi}(${lunarDisplay(solar).year})年 ${lunarDisplay(solar).monthLabel}${lunarDisplay(solar).dayLabel}`}
        />
      </div>

      <div className={styles.card}>
        <p className={styles.sectionTitle}>农历转公历</p>
        <div className={styles.lunarRow}>
          <select className={styles.select} value={lunarYear} onChange={(event) => setLunarYear(Number(event.target.value))}>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <select className={styles.select} value={lunarMonth} onChange={(event) => setLunarMonth(Number(event.target.value))}>
            {months.map((month) => (
              <option key={month.month} value={month.month}>
                {month.label}
              </option>
            ))}
          </select>
          <select className={styles.select} value={safeLunarDay} onChange={(event) => setLunarDay(Number(event.target.value))}>
            {Array.from({ length: dayCount }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                {lunarDayLabel(lunarYear, lunarMonth, day)}
              </option>
            ))}
          </select>
        </div>
        <ResultRow label="公历" value={toISODate(converted)} />
      </div>
    </div>
  );
}

function ResultCard({ headline, subline, badge }: { headline: string; subline: string; badge: string | null }) {
  return (
    <div className={styles.resultCard}>
      <p className={styles.resultHeadline}>{headline}</p>
      {subline !== '' && <p className={styles.resultSubline}>{subline}</p>}
      {badge !== null && <p className={styles.resultBadge}>{badge}</p>}
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.resultRow}>
      <span className={styles.resultLabel}>{label}</span>
      <span className={styles.resultValue}>{value}</span>
    </div>
  );
}

function QuickChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.quickChip} onClick={onClick}>
      {label}
    </button>
  );
}
