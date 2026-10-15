import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ErrorBoundary, ErrorFallback } from './ErrorBoundary';

describe('ErrorBoundary 路由级兜底', () => {
  it('从渲染异常派生可展示的错误信息', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error('boom-in-render'))).toEqual({
      message: 'boom-in-render',
    });
    expect(ErrorBoundary.getDerivedStateFromError('纯字符串异常')).toEqual({ message: '纯字符串异常' });
    expect(ErrorBoundary.getDerivedStateFromError(undefined)).toEqual({ message: '未知错误' });
  });

  it('友好错误页含说明、返回首页与导出当前数据按钮', () => {
    const html = renderToString(
      createElement(MemoryRouter, null, createElement(ErrorFallback, { message: 'boom-in-render' })),
    );
    expect(html).toContain('页面出错了');
    expect(html).toContain('返回首页');
    expect(html).toContain('导出当前数据');
    expect(html).toContain('boom-in-render');
  });

  it('无异常时原样渲染子节点', () => {
    const html = renderToString(
      createElement(MemoryRouter, null, createElement(ErrorBoundary, null, createElement('span', null, 'ok'))),
    );
    expect(html).toContain('ok');
  });
});
