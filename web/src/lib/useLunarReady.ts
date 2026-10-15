import { useSyncExternalStore } from 'react';
import { ensureLunar, isLunarReady, subscribeLunar } from './lunar';

/**
 * 订阅农历模块载入状态。返回 false 时表示农历数据尚未就绪，
 * 此时不可调用 calendar / birthday / lunar 中依赖农历的同步函数。
 */
export function useLunarReady(): boolean {
  return useSyncExternalStore(subscribeLunar, isLunarReady, () => false);
}

export { ensureLunar };
