/**
 * 模式切换的整体迁移（M11 §2）：纯逻辑（方向判定、确认文案、结果核对），
 * 真实 I/O 由 store 完成，便于单测。
 */
import type { ReminderItem, TagItem } from '../types/reminder';
import { stripSyncMeta } from './android-shape';

export type MigrationDirection = 'server-to-client' | 'client-to-server';

export interface MigrationCounts {
  reminders: number;
  tags: number;
  images: number;
}

export interface MigrationVerification {
  ok: boolean;
  note: string;
}

/** 目标模式对应的迁移方向；同模式或未知模式返回 null。 */
export function migrationDirection(from: 'server' | 'client', to: 'server' | 'client'): MigrationDirection | null {
  if (from === to) return null;
  return from === 'server' ? 'server-to-client' : 'client-to-server';
}

/** 统计当前数据量（图片按实际字节集合计）。 */
export function countsOf(reminders: Array<{ id: number }>, tags: Array<{ id: number }>, images: string[]): MigrationCounts {
  return { reminders: reminders.length, tags: tags.length, images: images.length };
}

/** 迁移前二次确认文案：写清方向与后果。 */
export function migrationConfirmMessage(direction: MigrationDirection, counts: MigrationCounts): string {
  const amount = `${counts.reminders} 条提醒、${counts.tags} 个标签、${counts.images} 张图片`;
  if (direction === 'server-to-client') {
    return `将把服务器上的全部数据（${amount}）迁移到本机浏览器，并覆盖本机现有数据。当前模式将切换为客户端模式。`;
  }
  return `将把本机的全部数据（${amount}）覆盖服务器现有数据。当前模式将切换为服务器模式。`;
}

/** 迁移完成的反馈文案（含条数与核对结果）。 */
export function migrationResultMessage(
  direction: MigrationDirection,
  counts: MigrationCounts,
  elapsedMs: number,
  revision?: number,
): string {
  const target = direction === 'server-to-client' ? '本机' : '服务器';
  const revisionText = revision === undefined ? '' : `，目标 revision ${revision}`;
  return `迁移完成：${target}现有 ${counts.reminders} 条提醒、${counts.tags} 个标签、${counts.images} 张图片，用时 ${Math.max(0, Math.round(elapsedMs))} ms${revisionText}，核对一致。`;
}

/**
 * 迁移后一致性核对：数量一致 + 抽样字段一致 + 图片数量一致。
 * `sampleOk` 由调用方比较首条提醒的 id/title/date 与首个标签名得到。
 */
export function verifyMigration(input: {
  expected: MigrationCounts;
  actual: MigrationCounts;
  sampleOk: boolean;
  actualImageNames: string[];
}): MigrationVerification {
  const problems: string[] = [];
  if (input.expected.reminders !== input.actual.reminders) {
    problems.push(`提醒数不一致（应为 ${input.expected.reminders}，实际 ${input.actual.reminders}）`);
  }
  if (input.expected.tags !== input.actual.tags) {
    problems.push(`标签数不一致（应为 ${input.expected.tags}，实际 ${input.actual.tags}）`);
  }
  if (input.expected.images !== input.actual.images) {
    problems.push(`图片数不一致（应为 ${input.expected.images}，实际 ${input.actual.images}）`);
  }
  if (input.expected.images > 0 && input.actualImageNames.length === 0) {
    problems.push('图片字节缺失');
  }
  if (!input.sampleOk) problems.push('抽样字段不一致');
  return problems.length === 0
    ? { ok: true, note: '数量、抽样字段与图片均已核对一致' }
    : { ok: false, note: problems.join('；') };
}

/** 迁移到客户端时去掉同步元数据（updatedAt 仅服务端合并需要）。 */
export function toLocalReminders(reminders: ReminderItem[]): ReminderItem[] {
  return reminders.map((item) => stripSyncMeta(item) as ReminderItem);
}

export function toLocalTags(tags: TagItem[]): TagItem[] {
  return tags.map((item) => stripSyncMeta(item) as TagItem);
}

/** 迁移到服务器时给条目打上统一的 `updatedAt`。 */
export function toServerReminders(reminders: ReminderItem[], at: number): ReminderItem[] {
  return reminders.map((item) => ({ ...item, updatedAt: at }));
}

export function toServerTags(tags: TagItem[], at: number): TagItem[] {
  return tags.map((item) => ({ ...item, updatedAt: at }));
}

/**
 * 是否允许发起切换；返回 null 表示可切换，否则返回不可切换的人话原因。
 * - 模式未知（仍在检测）：不允许；
 * - 目标与当前相同：不允许；
 * - 目标服务器模式但未检测到后端：不允许（入口置灰）。
 */
export function switchBlockedReason(current: string, target: 'server' | 'client', serverReachable: boolean): string | null {
  if (current === 'unknown') return '正在检测运行模式，请稍候';
  if (current === target) return '当前已是该模式';
  if (target === 'server' && !serverReachable) return '未检测到后端服务';
  return null;
}
