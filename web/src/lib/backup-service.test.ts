import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { settingsFromBackup, toBackupData, importBackup } from './backup-service';
import { BackupError, decodeArchive, encodeArchive } from './backup';
import { DEFAULT_SETTINGS } from './storage';
import type { BackupData } from '../types/reminder';
import { makeItem } from '../test/factories';

vi.mock('./storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storage')>();
  return {
    ...actual,
    replaceImageBlobs: async () => {},
    replaceFontBlobs: async () => {},
    listFontNames: async () => [],
    loadFontBlob: async () => undefined,
  };
});

describe('toBackupData 状态映射', () => {
  it('把本地设置映射为安卓字段名，Web 专有字段单独处理', () => {
    const data = toBackupData([makeItem({ id: 1 })], [], {
      ...DEFAULT_SETTINGS,
      themeOption: 'DARK',
      pureBlackEnabled: true,
      cardColoringEnabled: false,
      homeCategoryEnabled: false,
      defaultPage: 'BIRTHDAY',
      viewMode: 'LIST',
      scrollBehavior: 'NONE',
      dynamicColorEnabled: false,
      themeColorPalette: 'CYAN',
      customColorSeed: 424242,
      backupReminderEnabled: true,
    });
    expect(data).toMatchObject({
      themeOption: 'DARK',
      pureBlackEnabled: true,
      cardColoringEnabled: false,
      homeCategoryEnabled: false,
      defaultPage: 'BIRTHDAY',
      viewMode: 'LIST',
      scrollBehavior: 'NONE',
      dynamicColorEnabled: false,
      themeColorPalette: 'CYAN',
      customColorSeed: 424242,
      backupReminderEnabled: true,
    });
    // M12 §2：导出不得写入任何 WebDAV 凭据字段（键都不出现）；图片随 zip 走，不内联。
    expect('webDavServer' in data).toBe(false);
    expect('webDavUsername' in data).toBe(false);
    expect('webDavPassword' in data).toBe(false);
    expect('webDavPath' in data).toBe(false);
    expect(data.cardBackgroundImages).toBeNull();
    expect(data.reminders).toHaveLength(1);
  });

  it('导出映射不含应用锁字段（v / salt / iterations / hash）', () => {
    const data = toBackupData([], [], {
      ...DEFAULT_SETTINGS,
      appLockEnabled: true,
      appLockPasswordHash: {
        v: 2,
        algo: 'PBKDF2-SHA-256',
        salt: 'c2FsdA==',
        iterations: 210_000,
        hash: 'aGFzaA==',
      },
    });
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/"appLock/i);
    expect(json).not.toMatch(/"salt"\s*:/);
    expect(json).not.toMatch(/"iterations"\s*:/);
    expect(json).not.toMatch(/"hash"\s*:/);
    expect(json).not.toMatch(/"v"\s*:/);
  });
});

describe('M12 §2：导入兼容安卓凭据字段，但不回写任何导出包', () => {
  const androidWithCreds = {
    reminders: [],
    tags: [],
    webDavServer: 'https://dav.example.com',
    webDavUsername: 'davuser',
    webDavPassword: 'secret口令',
    webDavPath: '/dav/',
  } as unknown as BackupData;

  it('settingsFromBackup：读入 webDav* 并映射到本机 WebDAV 配置', () => {
    const settings = settingsFromBackup(androidWithCreds);
    expect(settings.webdavServer).toBe('https://dav.example.com/dav/');
    expect(settings.webdavUsername).toBe('davuser');
    expect(settings.webdavPassword).toBe('secret口令');
  });

  it('importBackup：含凭据的安卓包可正常导入，再导出不含这四个字段', async () => {
    const pkg = await encodeArchive({ metadataJson: JSON.stringify(androidWithCreds) }, false);
    const imported = await importBackup(pkg);
    expect(imported.settings.webdavUsername).toBe('davuser');
    expect(imported.settings.webdavPassword).toBe('secret口令');

    const reexport = await encodeArchive(
      {
        metadataJson: JSON.stringify(
          toBackupData([], [], { ...DEFAULT_SETTINGS, ...imported.settings }),
        ),
      },
      false,
    );
    const metadata = JSON.parse((await decodeArchive(reexport)).metadataJson) as Record<string, unknown>;
    for (const key of ['webDavServer', 'webDavUsername', 'webDavPassword', 'webDavPath']) {
      expect(key in metadata).toBe(false);
    }
    expect(JSON.stringify(metadata)).not.toContain('secret口令');
  });
});

describe('importBackup 坏包在写入本地前即失败', () => {
  it('空文件 / 缺 metadata.json / 非 zip 均抛 BackupError', async () => {
    await expect(importBackup(new Uint8Array(0))).rejects.toBeInstanceOf(BackupError);
    const noMetadata = zipSync({ 'images/a.png': strToU8('x') });
    await expect(importBackup(noMetadata)).rejects.toBeInstanceOf(BackupError);
    const random = crypto.getRandomValues(new Uint8Array(64));
    await expect(importBackup(random)).rejects.toBeInstanceOf(BackupError);
  });
});
