/**
 * 真安卓加密备份端到端回归（M3.1 §D）。
 *
 * 备份文件为负责人真机导出，只读引用，**不入库**：运行前用环境变量指向它即可，
 * 例如：
 *   REMINDER_ANDROID_BACKUP_ZIP=/root/.../android-backup.zip npx vitest run src/lib/android-backup.e2e.test.ts
 * 未设置时整组跳过，保证 CI 不依赖外部文件。
 */
import { describe, expect, it } from 'vitest';
import { decodeArchive, encodeArchive, parseBackupData } from './backup';
import { settingsFromBackup } from './backup-service';
import { reminderDisplayInfo } from './display';
import { buildReminderSections } from './sort';
import { todayLocalDate } from './local-date';

const BACKUP_PATH = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env?.REMINDER_ANDROID_BACKUP_ZIP;

async function readBackup(path: string): Promise<Uint8Array> {
  // 用变量形式的动态 import，避免为非浏览器测试引入 @types/node 依赖。
  const moduleName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ moduleName)) as {
    readFileSync: (file: string) => Uint8Array;
  };
  return new Uint8Array(fs.readFileSync(path));
}

describe.skipIf(BACKUP_PATH === undefined)('真安卓加密备份端到端（M3.1 D）', () => {
  it('加密包可解密、缺省归一化，并经首页展示管线渲染不抛错', async () => {
    const bytes = await readBackup(BACKUP_PATH!);
    const content = await decodeArchive(bytes);
    const metadata = parseBackupData(content.metadataJson);

    expect(metadata.reminders.length).toBeGreaterThan(0);
    const item = metadata.reminders[0]!;
    // 真机条目缺 endDate；归一化后必须是 null，否则 calendar 的 `=== null` 判断失效而白屏。
    expect(item.endDate).toBeNull();
    expect(item.repeatInfo).toBeNull();
    expect(item.notificationConfig.notificationTimes).toEqual([]);
    expect(item.cardBackgroundType).toBe('DEFAULT');

    // 首页分组与卡片展示计算（白屏现场走的正是这条链路）不抛错。
    const today = todayLocalDate();
    expect(() => buildReminderSections([item], metadata.tags ?? [], today)).not.toThrow();
    expect(reminderDisplayInfo(item, today).headerTitle).toContain('Backup');

    // 恢复结果：提醒列表非空，设置按归档映射（该真机包为 PURPLE + 自定义种子）。
    const settings = settingsFromBackup(metadata);
    expect(settings.themeColorPalette).toBe('PURPLE');
    expect(settings.dynamicColorEnabled).toBe(true);
    expect(settings.customColorSeed).toBe(-10071900);
  });

  it('明文导出 → 再导入往返，提醒与标签字段逐个相同', async () => {
    const bytes = await readBackup(BACKUP_PATH!);
    const content = await decodeArchive(bytes);
    const first = parseBackupData(content.metadataJson);

    const plain = await encodeArchive(
      { metadataJson: content.metadataJson, images: content.images, fonts: content.fonts },
      false,
    );
    const second = parseBackupData((await decodeArchive(plain)).metadataJson);

    expect(second.reminders).toEqual(first.reminders);
    expect(second.tags).toEqual(first.tags);
    expect(Object.keys(second.reminders[0]!).sort()).toEqual(Object.keys(first.reminders[0]!).sort());
  });
});
