import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

/**
 * 轻量冒烟测试：确认路由与首页在无浏览器环境下也能完成一次同步渲染（SSR），
 * 不会因导入或渲染期错误直接崩溃。
 */
describe('App 冒烟渲染', () => {
  it('首页可渲染出字标与分类导航', () => {
    const html = renderToString(
      createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(App)),
    );
    expect(html).toContain('Reminder');
    expect(html).toContain('倒数日');
    expect(html).toContain('正数日');
    expect(html).toContain('生日');
  });
});
