import { useEffect, type ReactNode } from 'react';
import { ensureLunar } from '../lib/lunar';
import { useLunarReady } from '../lib/useLunarReady';

/**
 * 农历模块门控：子页面渲染前确保 lunar-javascript 已按需载入。
 * 用于编辑 / 详情 / 搜索 / 计算器等会触发农历计算的懒加载路由，
 * 避免在首屏静态引入体积较大的农历数据表（§9 首屏 ≤200KB）。
 */
export function LunarGate({ children }: { children: ReactNode }) {
  const ready = useLunarReady();

  useEffect(() => {
    if (!ready) void ensureLunar();
  }, [ready]);

  if (!ready) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }} role="status">
        正在载入…
      </div>
    );
  }
  return <>{children}</>;
}
