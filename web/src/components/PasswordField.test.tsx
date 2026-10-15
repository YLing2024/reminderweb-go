import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { PasswordField } from './PasswordField';
import { UnlockForm } from './AppLockGate';

describe('PasswordField 结构', () => {
  it('默认 type=password、maxLength=128，且不设 inputMode', () => {
    const html = renderToString(
      createElement(PasswordField, {
        label: '密码',
        value: '',
        visible: false,
        onChange: () => {},
        onToggleVisible: () => {},
      }),
    );
    expect(html).toContain('type="password"');
    expect(html).toMatch(/maxlength="128"/i);
    expect(html).toContain('显示密码');
    expect(html).not.toContain('inputmode=');
    expect(html).not.toContain('pattern=');
  });

  it('visible 为真时切换为明文，按钮文案变为隐藏', () => {
    const html = renderToString(
      createElement(PasswordField, {
        label: '密码',
        value: 'My Pass!@#',
        visible: true,
        onChange: () => {},
        onToggleVisible: () => {},
      }),
    );
    expect(html).toContain('type="text"');
    expect(html).toContain('My Pass!@#');
    expect(html).toContain('隐藏密码');
  });
});

describe('UnlockForm 组件层', () => {
  it('空输入时提交禁用，输入框为非数字密码类型', () => {
    const html = renderToString(
      createElement(UnlockForm, { stored: 'a'.repeat(64), onUnlock: () => {} }),
    );
    expect(html).toContain('type="password"');
    expect(html).toMatch(/maxlength="128"/i);
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toContain('disabled');
    expect(html).toContain('解锁');
  });
});
