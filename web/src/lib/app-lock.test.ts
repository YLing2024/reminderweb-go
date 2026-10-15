import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  changeLockPassword,
  clearLockPassword,
  hashLegacyPassword,
  hashPassword,
  isAppLockCredential,
  isValidPassword,
  setupLockPassword,
  verifyCredential,
  verifyStoredPassword,
} from './app-lock';

describe('isValidPassword', () => {
  it('接受任意字符（字母 / 符号 / 空格 / 中文 / emoji）', () => {
    for (const password of ['1234', 'a', 'My Pass!@#', '中文密码', '🔒🔒', '  x  ']) {
      expect(isValidPassword(password)).toBe(true);
    }
  });

  it('不 trim、不过滤：仅“完全为空”非法', () => {
    expect(isValidPassword('  ')).toBe(true);
    expect(isValidPassword('')).toBe(false);
  });

  it('长度边界：1、128 通过；129 拒绝', () => {
    expect(isValidPassword('x')).toBe(true);
    expect(isValidPassword('x'.repeat(PASSWORD_MAX_LENGTH))).toBe(true);
    expect(isValidPassword('x'.repeat(PASSWORD_MAX_LENGTH + 1))).toBe(false);
  });
});

describe('hashPassword / verifyPassword', () => {
  it('同一密码两次哈希得到不同的盐与不同摘要', async () => {
    const first = await hashPassword('correct horse');
    const second = await hashPassword('correct horse');
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    expect(isAppLockCredential(first)).toBe(true);
    expect(first.v).toBe(2);
    expect(first.algo).toBe('PBKDF2-SHA-256');
    expect(first.iterations).toBe(210_000);
  });

  it('正确密码通过、错误密码不通过', async () => {
    const credential = await hashPassword('My Pass!@#');
    expect(await verifyCredential('My Pass!@#', credential)).toBe(true);
    expect(await verifyCredential('My Pass!@', credential)).toBe(false);
  });

  it('含中文 / emoji / 空格的密码可正确往返', async () => {
    const password = '中文 🔒 密码 ';
    const credential = await hashPassword(password);
    expect(await verifyCredential(password, credential)).toBe(true);
    expect(await verifyCredential('中文 🔒 密码', credential)).toBe(false);
  });
});

describe('verifyStoredPassword（v1 兼容与自动升级）', () => {
  it('v1 旧摘要：正确密码可解锁并返回可用的 v2 凭据', async () => {
    const legacy = await hashLegacyPassword('旧密码 123');
    const result = await verifyStoredPassword('旧密码 123', legacy);
    expect(result.ok).toBe(true);
    expect(result.upgraded).not.toBeNull();
    expect(result.upgraded?.v).toBe(2);
    expect(await verifyCredential('旧密码 123', result.upgraded!)).toBe(true);
  });

  it('v1 旧摘要：错误密码不通过且不升级', async () => {
    const legacy = await hashLegacyPassword('旧密码 123');
    const result = await verifyStoredPassword('错误', legacy);
    expect(result.ok).toBe(false);
    expect(result.upgraded).toBeNull();
  });

  it('v2 凭据：校验成功不产生升级对象', async () => {
    const credential = await hashPassword('新密码');
    const ok = await verifyStoredPassword('新密码', credential);
    expect(ok).toEqual({ ok: true, upgraded: null });
    const bad = await verifyStoredPassword('不是它', credential);
    expect(bad).toEqual({ ok: false, upgraded: null });
  });
});

describe('设置 / 修改 / 清除流程', () => {
  it('设置：二次确认不一致或非法长度时给出中文错误', async () => {
    const mismatch = await setupLockPassword('abc', 'abd');
    expect(mismatch).toEqual({ ok: false, error: '两次输入不一致' });
    const tooLong = await setupLockPassword('x'.repeat(129), 'x'.repeat(129));
    expect(tooLong).toEqual({ ok: false, error: '密码长度需为 1–128 个字符' });
    const empty = await setupLockPassword('', '');
    expect(empty).toEqual({ ok: false, error: '密码长度需为 1–128 个字符' });
  });

  it('设置：一字密码（含中文 emoji）可保存并可用', async () => {
    const result = await setupLockPassword('🔒 中文', '🔒 中文');
    expect(result.ok).toBe(true);
    if (result.ok) expect(await verifyCredential('🔒 中文', result.credential)).toBe(true);
  });

  it('修改：当前密码错误时拒绝', async () => {
    const credential = await hashPassword('旧密码');
    const result = await changeLockPassword('不是旧密码', '新密码', '新密码', credential);
    expect(result).toEqual({ ok: false, error: '当前密码不正确' });
  });

  it('修改：当前正确但两次新密码不一致时拒绝', async () => {
    const credential = await hashPassword('旧密码');
    const result = await changeLockPassword('旧密码', '新密码', '新密码x', credential);
    expect(result).toEqual({ ok: false, error: '两次输入不一致' });
  });

  it('修改：全部正确时返回可用新凭据', async () => {
    const credential = await hashPassword('旧密码');
    const result = await changeLockPassword('旧密码', '新密码', '新密码', credential);
    expect(result.ok).toBe(true);
    if (result.ok) expect(await verifyCredential('新密码', result.credential)).toBe(true);
  });

  it('清除：需正确密码', async () => {
    const credential = await hashPassword('要清掉的密码');
    expect(await clearLockPassword('错误', credential)).toBe(false);
    expect(await clearLockPassword('要清掉的密码', credential)).toBe(true);
  });
});
