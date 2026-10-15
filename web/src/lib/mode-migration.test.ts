/**
 * M11 §2 迁移纯逻辑：方向、计数、确认文案、结果核对、条目形状转换。
 */
import { describe, expect, it } from 'vitest';
import {
  countsOf,
  migrationConfirmMessage,
  migrationDirection,
  migrationResultMessage,
  switchBlockedReason,
  toLocalReminders,
  toLocalTags,
  toServerReminders,
  toServerTags,
  verifyMigration,
} from './mode-migration';
import { makeItem } from '../test/factories';

describe('migrationDirection', () => {
  it('同模式返回 null，跨模式返回方向', () => {
    expect(migrationDirection('server', 'server')).toBeNull();
    expect(migrationDirection('client', 'client')).toBeNull();
    expect(migrationDirection('server', 'client')).toBe('server-to-client');
    expect(migrationDirection('client', 'server')).toBe('client-to-server');
  });
});

describe('switchBlockedReason：切换门禁（含取消/置灰分支）', () => {
  it('同模式或检测中不允许；目标服务器但后端不可达不允许', () => {
    expect(switchBlockedReason('client', 'client', true)).toContain('已是');
    expect(switchBlockedReason('server', 'server', true)).toContain('已是');
    expect(switchBlockedReason('unknown', 'client', false)).toContain('检测');
    expect(switchBlockedReason('client', 'server', false)).toBe('未检测到后端服务');
  });

  it('跨模式且允许时放行', () => {
    expect(switchBlockedReason('client', 'server', true)).toBeNull();
    expect(switchBlockedReason('server', 'client', false)).toBeNull();
  });
});

describe('migrationConfirmMessage 写清方向与后果', () => {
  const counts = countsOf([{ id: 1 }, { id: 2 }], [{ id: 1 }], ['a.jpg']);

  it('服务器→客户端：迁移到本机并覆盖本机', () => {
    const message = migrationConfirmMessage('server-to-client', counts);
    expect(message).toContain('2 条提醒');
    expect(message).toContain('1 个标签');
    expect(message).toContain('1 张图片');
    expect(message).toContain('覆盖本机现有数据');
    expect(message).toContain('客户端模式');
  });

  it('客户端→服务器：覆盖服务器现有数据', () => {
    const message = migrationConfirmMessage('client-to-server', counts);
    expect(message).toContain('覆盖服务器现有数据');
    expect(message).toContain('服务器模式');
  });
});

describe('migrationResultMessage', () => {
  it('含条数、耗时与 revision', () => {
    const message = migrationResultMessage('client-to-server', { reminders: 1, tags: 2, images: 3 }, 42.6, 9);
    expect(message).toContain('1 条提醒');
    expect(message).toContain('2 个标签');
    expect(message).toContain('3 张图片');
    expect(message).toContain('43 ms');
    expect(message).toContain('revision 9');
    expect(message).toContain('核对一致');
  });
});

describe('verifyMigration 一致性核对', () => {
  it('数量 + 抽样 + 图片都一致时通过', () => {
    const result = verifyMigration({
      expected: { reminders: 1, tags: 1, images: 1 },
      actual: { reminders: 1, tags: 1, images: 1 },
      sampleOk: true,
      actualImageNames: ['a.jpg'],
    });
    expect(result.ok).toBe(true);
  });

  it('数量或抽样不一致时报出问题', () => {
    const result = verifyMigration({
      expected: { reminders: 2, tags: 1, images: 1 },
      actual: { reminders: 1, tags: 1, images: 1 },
      sampleOk: false,
      actualImageNames: [],
    });
    expect(result.ok).toBe(false);
    expect(result.note).toContain('提醒数不一致');
    expect(result.note).toContain('图片字节缺失');
    expect(result.note).toContain('抽样字段不一致');
  });
});

describe('条目形状转换', () => {
  it('迁到客户端去掉 updatedAt；迁到服务器补齐 updatedAt', () => {
    const reminders = [{ ...makeItem({ id: 1, title: '甲', date: '2026-01-01' }), updatedAt: 100 }];
    const local = toLocalReminders(reminders);
    expect('updatedAt' in local[0]!).toBe(false);
    const server = toServerReminders(local, 555);
    expect(server[0]!.updatedAt).toBe(555);

    const tags = [{ id: 1, name: '工作', color: '#2196F3', sortOrder: 1, updatedAt: 100 }];
    expect('updatedAt' in toLocalTags(tags)[0]!).toBe(false);
    expect(toServerTags(tags, 555)[0]!.updatedAt).toBe(555);
  });
});
