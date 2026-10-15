import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { AuthWarningBanner } from './AuthWarningBanner';

describe('AuthWarningBanner 默认口令提醒条（M12 §3.2）', () => {
  it('给出可读提醒与关闭按钮，不出现口令值', () => {
    const html = renderToString(createElement(AuthWarningBanner, { onDismiss: () => {} }));
    expect(html).toContain('默认口令或过短口令');
    expect(html).toContain('AUTH_PASSWORD');
    expect(html).toContain('知道了');
    expect(html).not.toContain('changeme');
  });
});
