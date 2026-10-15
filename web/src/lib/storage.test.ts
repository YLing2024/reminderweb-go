import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, migrateAppLockSettings } from './storage';

describe('DEFAULT_SETTINGS 默认值', () => {
  it('默认主题色板对齐上游（首启动为蓝色系）', () => {
    expect(DEFAULT_SETTINGS.themeColorPalette).toBe('BLUE');
    expect(DEFAULT_SETTINGS.dynamicColorEnabled).toBe(true);
  });

  it('默认未开启应用锁、无密码凭据', () => {
    expect(DEFAULT_SETTINGS.appLockEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.appLockPasswordHash).toBeNull();
  });
});

describe('migrateAppLockSettings（旧 PIN 字段兼容）', () => {
  it('把旧 appLockPinHash 搬运到 appLockPasswordHash 并删除旧键', () => {
    const legacy = 'a'.repeat(64);
    const migrated = migrateAppLockSettings({ appLockEnabled: true, appLockPinHash: legacy });
    expect(migrated.appLockPasswordHash).toBe(legacy);
    expect('appLockPinHash' in migrated).toBe(false);
    expect(migrated.appLockEnabled).toBe(true);
  });

  it('已有新字段时不覆盖，其余设置原样保留', () => {
    const migrated = migrateAppLockSettings({
      themeOption: 'DARK',
      appLockPasswordHash: { v: 2, algo: 'PBKDF2-SHA-256', salt: 's', iterations: 210_000, hash: 'h' },
      appLockPinHash: 'b'.repeat(64),
    });
    expect(migrated.appLockPasswordHash).toEqual({
      v: 2,
      algo: 'PBKDF2-SHA-256',
      salt: 's',
      iterations: 210_000,
      hash: 'h',
    });
    expect('appLockPinHash' in migrated).toBe(false);
    expect(migrated.themeOption).toBe('DARK');
  });

  it('两字段冲突且新字段无法识别时，回退到旧的可校验摘要', () => {
    const legacy = 'c'.repeat(64);
    const migrated = migrateAppLockSettings({
      appLockPasswordHash: { broken: true },
      appLockPinHash: legacy,
    });
    expect(migrated.appLockPasswordHash).toBe(legacy);
    expect('appLockPinHash' in migrated).toBe(false);
  });
});

describe('migrateLegacyWebDavSettings（已移除：客户端模式需要浏览器直连凭据）', () => {
  it('默认设置里 WebDAV 凭据字段存在且为空（仅本机，不上传）', () => {
    expect(DEFAULT_SETTINGS.webdavServer).toBe('');
    expect(DEFAULT_SETTINGS.webdavUsername).toBe('');
    expect(DEFAULT_SETTINGS.webdavPassword).toBe('');
  });
});
