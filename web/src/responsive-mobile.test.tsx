/**
 * 移动端响应式机检（需求书 `docs/REQUIREMENTS-responsive-mobile.md`）。
 *
 * 覆盖三件事：
 * 1. 遍历 `src` 下全部样式表，逐条解析 `font-size`（px / rem / em / % / clamp 下限），
 *    断言可见文本字号 ≥12px（这就是「卡片页脚 10.92px」那类问题的回归保护）；
 * 2. 逐个视图做 SSR 渲染，断言视图可渲染且没有内联 style 把字号压到 12px 以下；
 * 3. 断言触摸命中区：所有声明的 `min-height` ≥32px、主要操作 ≥44px、
 *    以及触屏（`pointer: coarse`）下把几个过小的图标/文字按钮抬到下限。
 *
 * 说明：vitest 默认不处理 CSS Modules（`import` 返回空对象），jsdom 无法据此还原
 * CSS Module 的级联，所以字号与命中区改为对源码样式表做静态断言——这正是需求书
 * 允许的「jsdom 量不到尺寸时改为断言 class/style」兜底；桌面观感不变由「新规则只出现在
 * `max-width` / `pointer: coarse` 媒体查询内」来保证（见 `媒体查询只在窄屏或触屏生效`）。
 */
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppLockGate } from './components/AppLockGate';
import { ReminderCard } from './components/ReminderCard';
import { makeItem } from './test/factories';
import AboutPage from './pages/AboutPage';
import BackupPage from './pages/BackupPage';
import DateCalculatorPage from './pages/DateCalculatorPage';
import DetailPage from './pages/DetailPage';
import EditPage from './pages/EditPage';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import TagPage from './pages/TagPage';

/**
 * 以原始文本读入 `src` 下全部样式表。
 *
 * 这里用运行时动态 `import()`（而非静态 import + 声明文件）读取 Node 内置模块：
 * 既能在 vitest（Node 环境）下工作，又不需要为本仓库新增 `@types/node` 依赖；
 * 而 vitest 默认会把 `.css` 导入打桩成空模块，所以只能从磁盘读源码文本。
 */
const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as {
  readdirSync(dir: string, options: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean }>;
  readFileSync(file: string, encoding: 'utf8'): string;
};
const path = (await import(/* @vite-ignore */ ['node', 'path'].join(':'))) as {
  dirname(value: string): string;
  join(...parts: string[]): string;
};

const SRC_DIR = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));

/** 可见文本字号下限（px）。 */
const MIN_VISIBLE_FONT_PX = 12;
/** 次要图标 / 文字按钮命中区下限（px）。 */
const MIN_SECONDARY_TARGET_PX = 32;
/** 主要操作命中区下限（px）。 */
const MIN_PRIMARY_TARGET_PX = 44;

interface CssRule {
  media: string | null;
  selector: string;
  body: string;
}

function listCssFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listCssFiles(full));
    else if (entry.name.endsWith('.css')) files.push(full);
  }
  return files;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 把样式表拆成「顶层规则 + @media 内的规则」，@font-face / @keyframes 直接跳过。 */
function parseRules(css: string, media: string | null = null, out: CssRule[] = []): CssRule[] {
  const source = stripComments(css);
  let index = 0;
  while (index < source.length) {
    const brace = source.indexOf('{', index);
    if (brace < 0) break;
    const selector = source.slice(index, brace).trim();
    let depth = 1;
    let cursor = brace + 1;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth += 1;
      else if (source[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    const body = source.slice(brace + 1, cursor - 1);
    if (selector.startsWith('@media')) parseRules(body, selector.slice('@media'.length).trim(), out);
    else if (!selector.startsWith('@')) out.push({ media, selector, body });
    index = cursor;
  }
  return out;
}

/** 单个长度值（px / rem / em）转 px；百分比、vw、var、calc 一律返回 null。 */
function lengthToPx(raw: string): number | null {
  const match = /^([0-9]*\.?[0-9]+)\s*(px|rem|em)$/.exec(raw.trim().toLowerCase());
  if (match === null) return null;
  const value = Number(match[1]);
  return match[2] === 'px' ? value : value * 16;
}

/** `font-size: clamp(a, b, c)` 取下限 a；其余按单值解析。 */
function fontSizeToPx(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  const clamp = /^clamp\(([\s\S]+)\)$/.exec(value);
  if (clamp !== null) {
    const first = (clamp[1] ?? '').split(',')[0] ?? '';
    return lengthToPx(first);
  }
  return lengthToPx(value);
}

function declareValues(body: string, property: string): Array<{ raw: string; px: number | null }> {
  const pattern = new RegExp(`${property}\\s*:\\s*([^;]+)`, 'gi');
  const values: Array<{ raw: string; px: number | null }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const raw = (match[1] ?? '').trim();
    values.push({ raw, px: property === 'font-size' ? fontSizeToPx(raw) : lengthToPx(raw) });
  }
  return values;
}

function selectorMatches(selector: string, className: string): boolean {
  return new RegExp(`\\.${className}(?![\\w-])`).test(selector);
}

/** 某类名在所有规则里声明过的最大盒尺寸（min-height/min-width/height/width）。 */
function maxDeclaredBoxPx(rules: CssRule[], className: string, media?: (value: string | null) => boolean): number {
  let max = 0;
  for (const rule of rules) {
    if (media !== undefined && !media(rule.media)) continue;
    if (!selectorMatches(rule.selector, className)) continue;
    for (const property of ['min-height', 'min-width', 'height', 'width']) {
      for (const value of declareValues(rule.body, property)) if (value.px !== null) max = Math.max(max, value.px);
    }
  }
  return max;
}

function declaredMinHeightPx(rules: CssRule[], className: string): number {
  let max = 0;
  for (const rule of rules) {
    if (!selectorMatches(rule.selector, className)) continue;
    for (const value of declareValues(rule.body, 'min-height')) if (value.px !== null) max = Math.max(max, value.px);
  }
  return max;
}

const cssFiles = listCssFiles(SRC_DIR);
const rulesByFile = new Map<string, CssRule[]>();
for (const file of cssFiles) rulesByFile.set(file, parseRules(fs.readFileSync(file, 'utf8')));

function rulesOf(relativePath: string): CssRule[] {
  const rules = rulesByFile.get(path.join(SRC_DIR, relativePath));
  if (rules === undefined) throw new Error(`未找到样式表：${relativePath}`);
  return rules;
}

function renderAt(path: string, routePath: string, element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(Routes, null, createElement(Route, { path: routePath, element })),
    ),
  );
}

describe('移动端响应式：可见文本字号下限', () => {
  it('全部样式表 font-size 折算后 ≥12px', () => {
    const violations: string[] = [];
    let checked = 0;
    for (const file of cssFiles) {
      const rules = rulesByFile.get(file);
      if (rules === undefined) continue;
      for (const rule of rules) {
        for (const value of declareValues(rule.body, 'font-size')) {
          checked += 1;
          if (value.px === null) {
            violations.push(`${file} ${rule.selector} font-size:${value.raw}（无法折算，请人工确认）`);
          } else if (value.px < MIN_VISIBLE_FONT_PX) {
            violations.push(`${file} ${rule.selector} font-size:${value.raw} = ${value.px}px`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('卡片页脚与搜索三角已固定为 12px（不再随窄屏缩到 10.92px / 11px）', () => {
    const footer = rulesOf('components/ReminderCard.module.css').find((rule) => rule.selector === '.footerText');
    expect(footer).toBeDefined();
    expect(declareValues(footer!.body, 'font-size').map((value) => value.px)).toEqual([12]);

    const caret = rulesOf('pages/SearchPage.module.css').find((rule) => rule.selector === '.chipCaret');
    expect(caret).toBeDefined();
    expect(declareValues(caret!.body, 'font-size').map((value) => value.px)).toEqual([12]);
  });
});

describe('移动端响应式：全部视图可渲染且无内联小字号', () => {
  // 说明：SSR 走 zustand 的 server snapshot（初始状态），数据驱动分支取不到；
  // 因此详情/首页等以「可渲染出非空结构」为断言，卡片页脚另由 ReminderCard 直渲染覆盖，
  // 登录弹窗只在 builtin 鉴权时挂载，改由 ServerLoginDialog.responsive.test.tsx 客户端渲染覆盖。
  const views: Array<{ name: string; html: () => string }> = [
    { name: '首页', html: () => renderAt('/', '/', createElement(HomePage)) },
    { name: '设置', html: () => renderAt('/settings', '/settings', createElement(SettingsPage)) },
    { name: '备份与恢复', html: () => renderAt('/backup', '/backup', createElement(BackupPage)) },
    { name: '日期计算', html: () => renderAt('/calculator', '/calculator', createElement(DateCalculatorPage)) },
    { name: '搜索', html: () => renderAt('/search', '/search', createElement(SearchPage)) },
    { name: '标签管理', html: () => renderAt('/tags', '/tags', createElement(TagPage)) },
    { name: '详情', html: () => renderAt('/reminder/1', '/reminder/:id', createElement(DetailPage)) },
    { name: '编辑', html: () => renderAt('/reminder/new', '/reminder/new', createElement(EditPage)) },
    { name: '关于', html: () => renderAt('/about', '/about', createElement(AboutPage)) },
    {
      name: '应用锁',
      html: () =>
        renderAt('/', '/', createElement(AppLockGate, null, createElement('span', null, '内容'))),
    },
    {
      name: '倒数日卡片（页脚）',
      html: () =>
        renderToStaticMarkup(
          createElement(ReminderCard, {
            item: makeItem({ title: '元旦', date: '2026-01-01', type: 'ANNUAL', isLunar: false }),
            today: { year: 2026, month: 1, day: 1 },
            onOpen: () => {},
          }),
        ),
    },
  ];

  it.each(views)('$name：渲染非空且内联字号 ≥12px', ({ html }) => {
    const markup = html();
    expect(markup.length).toBeGreaterThan(0);
    const inlineSizes = [...markup.matchAll(/font-size:\s*([0-9.]+)px/g)].map((match) => Number(match[1]));
    for (const size of inlineSizes) expect(size).toBeGreaterThanOrEqual(MIN_VISIBLE_FONT_PX);
  });
});

describe('移动端响应式：触摸命中区', () => {
  it('所有声明的 min-height（px）不小于 32px', () => {
    const violations: string[] = [];
    for (const file of cssFiles) {
      const rules = rulesByFile.get(file);
      if (rules === undefined) continue;
      for (const rule of rules) {
        for (const value of declareValues(rule.body, 'min-height')) {
          if (value.px !== null && value.px < MIN_SECONDARY_TARGET_PX) {
            violations.push(`${file} ${rule.selector} min-height:${value.raw}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  const primaryActions: Array<[string, string]> = [
    ['pages/HomePage.module.css', 'primaryButton'],
    ['pages/BackupPage.module.css', 'primaryButton'],
    ['pages/SettingsPage.module.css', 'textButton'],
    ['pages/TagPage.module.css', 'textButton'],
    ['pages/EditPage.module.css', 'todayButton'],
    ['pages/EditPage.module.css', 'addButton'],
    ['pages/DetailPage.module.css', 'backLink'],
    ['pages/AboutPage.module.css', 'link'],
    ['components/AppLockGate.module.css', 'submit'],
    ['components/ShareImageDialog.module.css', 'primary'],
    ['components/WebDavSettings.module.css', 'primaryButton'],
    ['components/ModeSettings.module.css', 'option'],
    ['components/ui.module.css', 'textButton'],
  ];

  it.each(primaryActions)('%s 的 .%s 主要操作 ≥44px 高', (file, className) => {
    expect(declaredMinHeightPx(rulesOf(file), className)).toBeGreaterThanOrEqual(MIN_PRIMARY_TARGET_PX);
  });

  const touchTargets: Array<[string, string, number]> = [
    ['pages/SearchPage.module.css', 'chipClear', MIN_SECONDARY_TARGET_PX],
    ['components/ErrorBoundary.module.css', 'bannerClose', MIN_SECONDARY_TARGET_PX],
    ['components/ServerStatusBar.module.css', 'action', MIN_SECONDARY_TARGET_PX],
    ['components/AppLockGate.module.css', 'forgot', MIN_SECONDARY_TARGET_PX],
    ['components/ServerLoginDialog.module.css', 'submit', MIN_PRIMARY_TARGET_PX],
  ];

  it.each(touchTargets)('%s 的 .%s 在触屏下命中区 ≥%dpx', (file, className, min) => {
    const rules = rulesOf(file);
    const coarse = rules.filter(
      (rule) => rule.media !== null && rule.media.includes('pointer: coarse') && selectorMatches(rule.selector, className),
    );
    expect(coarse.length).toBeGreaterThan(0);
    expect(maxDeclaredBoxPx(rules, className, (media) => media !== null && media.includes('pointer: coarse'))).toBeGreaterThanOrEqual(min);
  });
});

describe('移动端响应式：桌面观感不变（新规则只在窄屏 / 触屏生效）', () => {
  it('首页顶栏换行规则只在 max-width:599px 内声明', () => {
    const rules = rulesOf('pages/HomePage.module.css');
    const wrapRules = rules.filter(
      (rule) => /flex-wrap|row-gap/.test(rule.body) && (selectorMatches(rule.selector, 'topBar') || selectorMatches(rule.selector, 'topActions')),
    );
    expect(wrapRules.length).toBeGreaterThan(0);
    for (const rule of wrapRules) {
      expect(rule.media).not.toBeNull();
      expect(rule.media).toContain('max-width');
      expect(Number(/max-width:\s*(\d+)px/.exec(rule.media!)![1])).toBeLessThanOrEqual(600);
    }
  });

  it('字号下限的两处改动不依赖媒体查询（桌面本就 12px，逐像素不受影响）', () => {
    const footer = rulesOf('components/ReminderCard.module.css').find((rule) => rule.selector === '.footerText');
    const caret = rulesOf('pages/SearchPage.module.css').find((rule) => rule.selector === '.chipCaret');
    expect(footer?.media ?? null).toBeNull();
    expect(caret?.media ?? null).toBeNull();
  });

  it('不存在任何 max-width 断点在 992px 以上（保证 ≥992px 布局不被窄屏规则命中）', () => {
    for (const file of cssFiles) {
      const rules = rulesByFile.get(file);
      if (rules === undefined) continue;
      for (const rule of rules) {
        if (rule.media === null) continue;
        const maxWidth = /max-width:\s*(\d+)px/.exec(rule.media);
        if (maxWidth !== null) expect(Number(maxWidth[1])).toBeLessThan(992);
      }
    }
  });
});
