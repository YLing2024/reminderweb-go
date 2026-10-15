import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { CloudBackupList, SyncStatusPanel, WebDavSettings } from './WebDavSettings';
import type { SyncStatus } from '../lib/api';

const FIRST = {
  name: 'reminder-backup-20260102-120000.zip',
  size: 2048,
  modifiedAt: 1_700_000_000_000,
};

const SECOND = {
  name: 'reminder-backup-20260101-120000.zip',
  size: 512,
  modifiedAt: 1_690_000_000_000,
};

const STATUS: SyncStatus = {
  enabled: true,
  url: 'https://dav.example.com/reminder/',
  lastSyncAt: 1_700_000_000_000,
  lastUploadAt: 1_700_000_000_000,
  lastResult: 'ok',
  lastError: null,
  pendingChanges: true,
  remoteFiles: [],
  nextSyncAt: 1_700_000_600_000,
  lastMerged: 3,
  lastAction: 'restore',
};

describe('CloudBackupList 云端备份列表', () => {
  it('空态显示「云端还没有备份」', () => {
    const html = renderToString(
      createElement(CloudBackupList, { files: [], onRestore: () => {}, onDelete: () => {}, busy: false }),
    );
    expect(html).toContain('云端还没有备份');
  });

  it('渲染名称/大小/恢复删除；任何备份都可删除（不再置灰）', () => {
    const html = renderToString(
      createElement(CloudBackupList, {
        files: [FIRST, SECOND],
        onRestore: () => {},
        onDelete: () => {},
        busy: false,
      }),
    );
    expect(html).toContain(FIRST.name);
    expect(html).toContain(SECOND.name);
    expect(html).toContain('2.0 KB');
    expect(html).toContain('512 B');
    expect(html.match(/>恢复<\/button>/g)?.length).toBe(2);
    expect(html.match(/>删除<\/button>/g)?.length).toBe(2);
    expect(html.match(/disabled=""/g) ?? []).toHaveLength(0);
  });

  it('busy 时恢复与删除按钮都禁用', () => {
    const html = renderToString(
      createElement(CloudBackupList, {
        files: [FIRST],
        onRestore: () => {},
        onDelete: () => {},
        busy: true,
      }),
    );
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });
});

describe('SyncStatusPanel 状态渲染', () => {
  it('启用 + 待上传 + 下次自动同步 + 动作/结果', () => {
    const html = renderToString(
      createElement(SyncStatusPanel, { loaded: true, error: null, enabled: true, status: STATUS }),
    );
    expect(html).toContain('已启用');
    expect(html).toContain('https://dav.example.com/reminder/');
    expect(html).toContain('有改动待上传');
    expect(html).toContain('从备份恢复');
    expect(html).toContain('成功');
    expect(html).toContain('下次自动同步');
  });

  it('未加载 / 未启用 / 尚未同步', () => {
    const html = renderToString(
      createElement(SyncStatusPanel, {
        loaded: false,
        error: null,
        enabled: false,
        status: null,
      }),
    );
    expect(html).toContain('读取中…');
    expect(html).toContain('尚未同步');
    expect(html).toContain('暂无');
  });

  it('读取失败时显示错误文案', () => {
    const html = renderToString(
      createElement(SyncStatusPanel, { loaded: true, error: '连不上服务器', enabled: false, status: null }),
    );
    expect(html).toContain('连不上服务器');
  });
});

describe('WebDavSettings 两模式分组显隐', () => {
  it('服务器模式：显示服务端策略面板，不出现浏览器直连输入框', () => {
    const html = renderToString(createElement(WebDavSettings, { onNotice: () => {}, mode: 'server' }));
    expect(html).toContain('凭据保存在服务器，由服务器与 WebDAV 通信');
    expect(html).toContain('立即同步');
    expect(html).toContain('自动同步');
    expect(html).not.toContain('placeholder="https://dav.example.com/dav/"');
    expect(html).not.toContain('测试连接');
    // 服务器模式不显示连接方式选项（M11 §3.3）。
    expect(html).not.toContain('WebDAV 连接方式');
  });

  it('客户端模式：显示 WebDAV 配置与经服务器转发的说明', () => {
    const html = renderToString(createElement(WebDavSettings, { onNotice: () => {}, mode: 'client' }));
    expect(html).toContain('placeholder="https://dav.example.com/dav/"');
    expect(html).toContain('测试连接');
    expect(html).toContain('立即备份');
    expect(html).toContain('从云端恢复');
    expect(html).toContain('自动备份');
    expect(html).toContain('保留份数');
    expect(html).toContain('WebDAV 请求经本应用服务器转发，因此浏览器不受跨域限制。');
    // M12 §3.1：内网转发开关与说明进入设置页（SSR 下后端未知，置灰并给提示）。
    expect(html).toContain('允许转发到内网地址');
    expect(html).toContain('只有当你的 WebDAV 装在局域网');
    expect(html).toContain('需要本应用服务器在运行才能修改该开关。');
    expect(html).not.toContain('立即同步');
  });

  it('客户端模式：不再出现「连接方式」三选一', () => {
    const html = renderToString(createElement(WebDavSettings, { onNotice: () => {}, mode: 'client' }));
    expect(html).not.toContain('WebDAV 连接方式');
    expect(html).not.toContain('同源代理');
    expect(html).not.toContain('直连');
    expect(html).not.toContain('自动（推荐）');
  });

  it('检测中：显示检测提示', () => {
    const html = renderToString(createElement(WebDavSettings, { onNotice: () => {}, mode: 'unknown' }));
    expect(html).toContain('正在检测运行模式');
  });
});
