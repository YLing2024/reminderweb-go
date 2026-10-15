import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  UNLOCK_SESSION_KEY,
  isSessionUnlocked,
  markSessionUnlocked,
  clearSessionUnlocked,
} from './app-lock';

/** 最小 Storage 替身：够验会标记 / 清标记 / 缺存储时不炸。 */
function fakeSessionStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    raw: map,
  } as Storage & { raw: Map<string, string> };
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');

function setStorage(value: unknown) {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (original) {
    Object.defineProperty(globalThis, 'sessionStorage', original);
  } else {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  }
});

describe('应用锁的会话解锁标记', () => {
  let store: Storage & { raw: Map<string, string> };

  beforeEach(() => {
    store = fakeSessionStorage();
    setStorage(store);
  });

  it('默认未解锁', () => {
    expect(isSessionUnlocked()).toBe(false);
  });

  it('标记后为已解锁，键名带 reminderweb: 前缀', () => {
    markSessionUnlocked();
    expect(isSessionUnlocked()).toBe(true);
    expect(store.raw.get(UNLOCK_SESSION_KEY)).toBe('1');
    expect(UNLOCK_SESSION_KEY.startsWith('reminderweb:')).toBe(true);
  });

  it('清除后回到未解锁（用于从后台切回）', () => {
    markSessionUnlocked();
    clearSessionUnlocked();
    expect(isSessionUnlocked()).toBe(false);
  });

  it('幂等：重复标记与重复清除都不抛错', () => {
    markSessionUnlocked();
    markSessionUnlocked();
    clearSessionUnlocked();
    clearSessionUnlocked();
    expect(isSessionUnlocked()).toBe(false);
  });

  it('只认值 "1"，被改写成别的值一律按未解锁', () => {
    store.raw.set(UNLOCK_SESSION_KEY, 'true');
    expect(isSessionUnlocked()).toBe(false);
  });

  it('没有 sessionStorage（隐私模式 / SSR）时不抛错，按未解锁处理', () => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    expect(() => markSessionUnlocked()).not.toThrow();
    expect(() => clearSessionUnlocked()).not.toThrow();
    expect(isSessionUnlocked()).toBe(false);
  });

  it('sessionStorage 抛错时也不炸', () => {
    setStorage({
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    });
    expect(() => markSessionUnlocked()).not.toThrow();
    expect(() => clearSessionUnlocked()).not.toThrow();
    expect(isSessionUnlocked()).toBe(false);
  });
});
