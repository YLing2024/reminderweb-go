// @vitest-environment jsdom
/**
 * 登录弹窗的响应式机检：请求书要求巡视「登录页」。
 *
 * `ServerLoginDialog` 只在 builtin 鉴权（`authRequired && authMode === 'builtin'`）时挂载，
 * SSR 走 zustand 的 server snapshot（初始状态）拿不到该组合，因此这里用 jsdom 客户端渲染：
 * 组件本身没有副作用（无 useEffect），客户端渲染可安全拿到真实 DOM 结构。
 * 样式（字号 ≥12px、主按钮命中区）由 `responsive-mobile.test.tsx` 对样式表做静态断言覆盖。
 */
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { ServerLoginDialog } from './ServerLoginDialog';
import { useReminderStore } from '../store/useReminderStore';

describe('登录弹窗（jsdom 客户端渲染）', () => {
  it('builtin 鉴权下渲染出登录表单，且无内联小字号', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useReminderStore.setState({ authRequired: true, authMode: 'builtin' });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(createElement(StrictMode, null, createElement(ServerLoginDialog)));
    });
    const markup = container.innerHTML;
    act(() => {
      root.unmount();
    });
    container.remove();

    expect(markup).toContain('登录服务器');
    expect(markup).toContain('用户名');
    expect(markup).toContain('登录');

    const inlineSizes = [...markup.matchAll(/font-size:\s*([0-9.]+)px/g)].map((match) => Number(match[1]));
    for (const size of inlineSizes) expect(size).toBeGreaterThanOrEqual(12);
  });
});
