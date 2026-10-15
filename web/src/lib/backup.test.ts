import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  BackupError,
  backupFileName,
  collectArchiveImages,
  decodeArchive,
  decodeInlineImages,
  encodeArchive,
  parseBackupData,
  referencedImageNames,
  tryDecryptArchive,
  type ArchiveInput,
} from './backup';
import type { BackupData, ReminderItem } from '../types/reminder';
import { makeItem } from '../test/factories';

function makeBackup(overrides: Partial<BackupData> = {}): BackupData {
  return {
    reminders: [],
    tags: null,
    themeOption: null,
    pureBlackEnabled: null,
    cardColoringEnabled: null,
    defaultPage: null,
    viewMode: null,
    backupReminderEnabled: null,
    webDavServer: null,
    webDavUsername: null,
    webDavPassword: null,
    webDavPath: null,
    dynamicColorEnabled: null,
    themeColorPalette: null,
    customColorSeed: null,
    scrollBehavior: null,
    homeCategoryEnabled: null,
    cardBackgroundImages: null,
    ...overrides,
  };
}

function metadataOf(backup: BackupData): string {
  return JSON.stringify(backup);
}

function inputWith(backup: BackupData, images?: Record<string, Uint8Array>): ArchiveInput {
  return { metadataJson: metadataOf(backup), images };
}

describe('backupFileName 与上游一致', () => {
  it('reminder-backup-yyyyMMdd-HHmmss.zip', () => {
    expect(backupFileName(new Date(2026, 9, 7, 16, 15, 3))).toBe('reminder-backup-20261007-161503.zip');
  });

  it('个位月/日/时补零', () => {
    expect(backupFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe('reminder-backup-20260102-030405.zip');
  });
});

describe('明文 zip 真往返', () => {
  it('打包后再解析，metadata 与图片逐字节一致', async () => {
    const item = makeItem({ id: 7, title: '春节', date: '2026-02-17', isLunar: true, tag: '节日' });
    const backup = makeBackup({ reminders: [item], tags: [{ id: 1, name: '节日', color: '#2196F3', sortOrder: 1 }] });
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
    const archive = await encodeArchive(inputWith(backup, { 'bg.png': imageBytes }), false);

    // 明文包应为标准 zip：以 "PK\x03\x04" 开头。
    expect([archive[0], archive[1], archive[2], archive[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const decoded = await decodeArchive(archive);
    expect(JSON.parse(decoded.metadataJson)).toEqual(backup);
    expect(Array.from(decoded.images['bg.png']!)).toEqual(Array.from(imageBytes));
  });

  it('fonts/ 条目同样原样读写（可选字体不丢）', async () => {
    const backup = makeBackup({ reminders: [makeItem({ id: 8, title: '字体' })] });
    const fontBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 9, 8, 7]);
    const archive = await encodeArchive(
      { metadataJson: metadataOf(backup), fonts: { 'custom.ttf': fontBytes } },
      true,
    );
    const decoded = await decodeArchive(archive);
    expect(Array.from(decoded.fonts['custom.ttf']!)).toEqual(Array.from(fontBytes));
    expect(decoded.images).toEqual({});
  });

  it('parseBackupData 返回深比较一致的 BackupData', async () => {
    const item = makeItem({ id: 3, title: '毕业', date: '2026-06-30' });
    const backup = makeBackup({ reminders: [item] });
    const archive = await encodeArchive(inputWith(backup), false);
    const decoded = await decodeArchive(archive);
    expect(parseBackupData(decoded.metadataJson)).toEqual(backup);
  });
});

describe('加密包真往返（AES/CBC/PKCS5Padding）', () => {
  it('加密 → 解密 → 解包，内容与明文一致', async () => {
    const items: ReminderItem[] = [
      makeItem({ id: 1, title: '甲', date: '2026-01-01' }),
      makeItem({ id: 2, title: '乙', date: '2027-05-20', repeatInfo: { interval: 1, unit: 'YEAR', endDate: null } }),
    ];
    const backup = makeBackup({ reminders: items, pureBlackEnabled: true, themeColorPalette: 'CYAN' });
    const imageBytes = new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 256));
    const archive = await encodeArchive(inputWith(backup, { 'photo.jpg': imageBytes }), true);

    // 密文布局 [16 字节 IV][密文]，整体长度 > 16 且非 zip 魔数。
    expect(archive.length).toBeGreaterThan(16);
    expect([archive[0], archive[1], archive[2], archive[3]]).not.toEqual([0x50, 0x4b, 0x03, 0x04]);

    const decoded = await decodeArchive(archive);
    expect(JSON.parse(decoded.metadataJson)).toEqual(backup);
    expect(Array.from(decoded.images['photo.jpg']!)).toEqual(Array.from(imageBytes));
  });

  it('tryDecryptArchive 还原出内部 zip（PK 魔数 + CBC 分组对齐）', async () => {
    const backup = makeBackup({ reminders: [makeItem({ id: 9, title: '丙' })] });
    const archive = await encodeArchive(inputWith(backup), true);
    const zipBytes = await tryDecryptArchive(archive);
    expect(zipBytes).not.toBeNull();
    expect([zipBytes![0], zipBytes![1], zipBytes![2], zipBytes![3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // IV 之外的密文长度为 16 的整数倍（CBC + PKCS5 填充）。
    expect((archive.length - 16) % 16).toBe(0);
  });

  it('错误密钥/被篡改的密文解密失败返回 null，不会抛异常', async () => {
    const backup = makeBackup({ reminders: [] });
    const archive = await encodeArchive(inputWith(backup), true);
    const tampered = archive.slice();
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! ^ 0xff) & 0xff;
    // 篡改后要么解密结果非法 zip（抛 BackupError），要么解密失败（BackupError）。
    await expect(decodeArchive(tampered)).rejects.toBeInstanceOf(BackupError);
  });
});

describe('未知字段导入导出不丢失', () => {
  it('液态玻璃参数与未来新增字段原样保留', async () => {
    const item = makeItem({
      id: 5,
      title: '带玻璃参数',
      cardBackgroundGlassRefraction: 0.31,
      cardBackgroundGlassTransparency: 0.88,
      customGlassHighlight: 0.42,
    }) as ReminderItem & Record<string, unknown>;
    item.liquidGlassFutureField = { a: 1, b: ['x', 'y'] };
    const backup = makeBackup({ reminders: [item] });
    const archive = await encodeArchive(inputWith(backup), true);
    const decoded = await decodeArchive(archive);
    const restored = parseBackupData(decoded.metadataJson);
    expect(restored).toEqual(backup);
    expect((restored.reminders[0] as Record<string, unknown>).liquidGlassFutureField).toEqual({ a: 1, b: ['x', 'y'] });
    expect(restored.reminders[0]!.cardBackgroundGlassRefraction).toBe(0.31);
  });
});

describe('坏包 / 缺 metadata.json 友好报错', () => {
  it('缺 metadata.json 抛 BackupError 且信息可读', async () => {
    const badZip = zipSync({ 'images/x.png': strToU8('img'), 'readme.txt': strToU8('hi') });
    await expect(decodeArchive(badZip)).rejects.toBeInstanceOf(BackupError);
    await expect(decodeArchive(badZip)).rejects.toThrow(/metadata\.json/);
  });

  it('随机字节既不是 zip 也无法解密时抛 BackupError', async () => {
    const random = crypto.getRandomValues(new Uint8Array(64));
    await expect(decodeArchive(random)).rejects.toThrow(/无法识别|解密/);
  });

  it('空文件抛 BackupError，不白屏', async () => {
    await expect(decodeArchive(new Uint8Array(0))).rejects.toBeInstanceOf(BackupError);
    await expect(decodeArchive(new Uint8Array(0))).rejects.toThrow(/无法识别|解密/);
  });

  it('metadata.json 非法 JSON 时报错', () => {
    expect(() => parseBackupData('{ not json')).toThrow(BackupError);
  });

  it('metadata.json 缺少 reminders 列表时报错', () => {
    expect(() => parseBackupData(JSON.stringify({ tags: [] }))).toThrow(/reminders/);
  });

  it('空数据不写坏：坏包解析在返回前即失败', async () => {
    const badZip = zipSync({ 'metadata.json': strToU8('{"reminders":[]}'), 'images/a.png': strToU8('x') });
    const decoded = await decodeArchive(badZip);
    expect(decoded.metadataJson).toBe('{"reminders":[]}');
  });
});

describe('引用图片与内联图片还原', () => {
  it('referencedImageNames 收集条目路径与额外映射', () => {
    const items = [
      makeItem({ id: 1, cardBackgroundImagePath: 'images/a.png' }),
      makeItem({ id: 2, cardBackgroundImagePath: '' }),
      makeItem({ id: 3, cardBackgroundImagePath: 'b.jpg' }),
    ];
    expect(referencedImageNames(items, { 'c.webp': '' }).sort()).toEqual(['a.png', 'b.jpg', 'c.webp']);
  });

  it('decodeInlineImages 还原 base64 图片并取 basename', () => {
    const inline = { 'images/old.png': 'data:image/png;base64,AQIDBA==' };
    const decoded = decodeInlineImages(inline);
    expect(Array.from(decoded['old.png']!)).toEqual([1, 2, 3, 4]);
  });

  it('collectArchiveImages 合并内联与 zip 图片（zip 优先）', async () => {
    const backup = makeBackup({ reminders: [], cardBackgroundImages: { 'i.png': 'AQID' } });
    const content = { metadataJson: metadataOf(backup), images: { 'i.png': new Uint8Array([9, 9]) }, fonts: {} };
    const merged = collectArchiveImages(content, backup);
    expect(Array.from(merged['i.png']!)).toEqual([9, 9]);
  });
});

describe('导入缺省字段归一化（M3.1 A）', () => {
  it('parseBackupData 把只有 7 个 key 的条目补齐为完整对象', async () => {
    const raw = {
      reminders: [
        { id: 1, title: '真机', date: '2026-10-07', type: 'ANNUAL', isLunar: false, tag: '', isPinned: false },
      ],
      tags: [],
    };
    const archive = await encodeArchive({ metadataJson: JSON.stringify(raw) }, true);
    const content = await decodeArchive(archive);
    const parsed = parseBackupData(content.metadataJson);

    expect(parsed.reminders[0]!.endDate).toBeNull();
    expect(parsed.reminders[0]!.repeatInfo).toBeNull();
    expect(parsed.reminders[0]!.notificationConfig.notificationTimes).toEqual([]);
    expect(parsed.reminders[0]!.cardBackgroundType).toBe('DEFAULT');
    expect(parsed.reminders[0]!.customFontWeight).toBe(700);
  });

  it('标签缺 color/sortOrder 时补默认值', async () => {
    const raw = { reminders: [], tags: [{ id: 2, name: '节日' }] };
    const archive = await encodeArchive({ metadataJson: JSON.stringify(raw) }, false);
    const content = await decodeArchive(archive);
    const parsed = parseBackupData(content.metadataJson);
    expect(parsed.tags).toEqual([{ id: 2, name: '节日', color: '#2196F3', sortOrder: 0 }]);
  });
});

