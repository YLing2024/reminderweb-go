/**
 * 服务器同步：页面可见性变化与 30 秒轮询（需求 §7「多标签 / 多设备一致性」）。
 *
 * 只在服务器模式下生效；`refresh` 内部会在 revision 未变化时直接返回，不触发重渲染。
 */
import { useEffect } from 'react';
import { useReminderStore } from '../store/useReminderStore';

export const SERVER_POLL_INTERVAL_MS = 30_000;

export function useServerSync(): void {
  const mode = useReminderStore((state) => state.mode);

  useEffect(() => {
    if (mode !== 'server') return undefined;
    const refresh = () => {
      void useReminderStore.getState().refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(refresh, SERVER_POLL_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [mode]);
}
