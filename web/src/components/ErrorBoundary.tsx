/**
 * 路由级渲染错误边界 + 未捕获 Promise 兜底提示（M3.1 §B）。
 *
 * 目标：任何渲染异常都落在带「返回首页」「导出当前数据」的友好错误页，
 * 不再出现纯白屏；未处理的 promise rejection 也在底部给出可关闭提示。
 */
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { exportBackup } from '../lib/backup-service';
import { downloadBlob } from '../lib/download';
import { useReminderStore } from '../store/useReminderStore';
import styles from './ErrorBoundary.module.css';

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  if (typeof error === 'string' && error.trim() !== '') return error;
  return '未知错误';
}

function ExportDataButton() {
  const reminders = useReminderStore((state) => state.reminders);
  const tags = useReminderStore((state) => state.tags);
  const settings = useReminderStore((state) => state.settings);
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'fail'>('idle');

  const handleExport = async () => {
    setStatus('busy');
    try {
      const result = await exportBackup(reminders, tags, settings, settings.backupEncryptionEnabled);
      downloadBlob(result.blob, result.fileName);
      setStatus('done');
    } catch {
      setStatus('fail');
    }
  };

  const label = status === 'busy' ? '正在导出…' : status === 'done' ? '已导出' : status === 'fail' ? '导出失败，重试' : '导出当前数据';
  return (
    <button type="button" className={styles.secondary} disabled={status === 'busy'} onClick={() => void handleExport()}>
      {label}
    </button>
  );
}

export function ErrorFallback({ message }: { message: string }) {
  const navigate = useNavigate();
  return (
    <div className={styles.page} role="alert">
      <h1 className={styles.title}>页面出错了</h1>
      <p className={styles.message}>
        渲染这个页面时发生异常。可以先导出当前数据，再返回首页重试；本地数据不会因此丢失。
      </p>
      <p className={styles.detail}>{message}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => navigate('/')}>
          返回首页
        </button>
        <ExportDataButton />
      </div>
    </div>
  );
}

interface ErrorBoundaryState {
  message: string | null;
}

/** 包裹路由的渲染错误边界。 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: describeError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Reminder 渲染异常：', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.message !== null) return <ErrorFallback message={this.state.message} />;
    return this.props.children;
  }
}

/** 未捕获的 promise / 运行期异常的底部兜底提示。 */
export function UnhandledErrorNotice() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => setMessage(describeError(event.reason));
    const onError = (event: ErrorEvent) => {
      if (event.error != null) setMessage(describeError(event.error));
    };
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);

  if (message === null) return null;
  return (
    <div className={styles.banner} role="alert">
      <span className={styles.bannerText}>出现未处理的错误：{message}</span>
      <button type="button" className={styles.bannerClose} onClick={() => setMessage(null)}>
        知道了
      </button>
    </div>
  );
}
