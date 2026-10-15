/**
 * M11 §1 设置页「运行模式」区域渲染：当前模式、切换入口、纯静态置灰说明。
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ModeSettings } from './ModeSettings';
import type { StorageMode } from '../store/useReminderStore';

function render(mode: StorageMode, serverReachable: boolean): string {
  return renderToString(createElement(ModeSettings, { onNotice: () => {}, mode, serverReachable }));
}

describe('ModeSettings', () => {
  it('客户端模式且后端不可达：服务器入口置灰并说明未检测到后端服务', () => {
    const html = render('client', false);
    expect(html).toContain('当前模式');
    expect(html).toContain('客户端模式（纯前端）');
    expect(html).toContain('服务器模式');
    expect(html).toContain('未检测到后端服务');
    expect(html).toContain('disabled=""');
  });

  it('服务器模式：显示当前模式为服务器模式，不出现过期置灰原因', () => {
    const html = render('server', true);
    expect(html).toContain('服务器模式');
    expect(html).not.toContain('未检测到后端服务');
  });

  it('检测中：提示检测中且两个入口都不可点', () => {
    const html = render('unknown', false);
    expect(html).toContain('检测中');
    expect(html).toContain('disabled=""');
  });
});
