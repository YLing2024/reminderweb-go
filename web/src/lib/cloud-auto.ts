/**
 * 自动云备份：监听数据变动，延迟合并为一次上传（需求 M4 §2「自动备份」）。
 *
 * 上传在后台进行，不阻塞 UI；失败只写状态，不打断用户操作。
 * 仅在客户端（纯前端）模式的 WebDAV 配置中使用（请求经本应用服务器转发）。
 */
import { useEffect } from 'react';
import { useReminderStore } from '../store/useReminderStore';
import { uploadCurrentBackup } from './cloud-backup';
import { AUTO_BACKUP_DELAY_MS, createThrottledRunner } from './webdav';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '自动备份失败';
}

export function useCloudAutoBackup(): void {
  const mode = useReminderStore((state) => state.mode);
  const enabled = useReminderStore((state) => state.settings.webdavEnabled);
  const autoBackup = useReminderStore((state) => state.settings.webdavAutoBackup);

  useEffect(() => {
    if (mode !== 'client' || !enabled || !autoBackup) return undefined;

    const runner = createThrottledRunner(async () => {
      const state = useReminderStore.getState();
      try {
        const outcome = await uploadCurrentBackup({
          reminders: state.reminders,
          tags: state.tags,
          settings: state.settings,
        });
        await useReminderStore.getState().updateSettings({
          webdavLastSuccessAt: Date.now(),
          webdavLastResult: `自动备份成功：${outcome.fileName}`,
        });
      } catch (error) {
        await useReminderStore.getState().updateSettings({
          webdavLastResult: `自动备份失败：${errorMessage(error)}`,
        });
      }
    }, AUTO_BACKUP_DELAY_MS);

    const unsubscribe = useReminderStore.subscribe((state, previous) => {
      // 忽略启动时的首次载入，只对运行期间的数据变动排期。
      if (!state.loaded || !previous.loaded) return;
      if (state.reminders === previous.reminders && state.tags === previous.tags) return;
      runner.schedule();
    });

    return () => {
      unsubscribe();
      runner.cancel();
    };
  }, [mode, enabled, autoBackup]);
}
