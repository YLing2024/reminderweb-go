import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLockGate } from './components/AppLockGate';
import { ErrorBoundary, UnhandledErrorNotice } from './components/ErrorBoundary';
import { LunarGate } from './components/LunarGate';
import { ServerLoginDialog } from './components/ServerLoginDialog';
import { ServerStatusBar } from './components/ServerStatusBar';
import { ThemeController } from './components/ThemeController';
import HomePage from './pages/HomePage';
import { useCloudAutoBackup } from './lib/cloud-auto';
import { useNotificationScheduler } from './lib/notifications';
import { useServerSync } from './lib/server-sync';
import { useReminderStore } from './store/useReminderStore';

const EditPage = lazy(() => import('./pages/EditPage'));
const DetailPage = lazy(() => import('./pages/DetailPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const TagPage = lazy(() => import('./pages/TagPage'));
const DateCalculatorPage = lazy(() => import('./pages/DateCalculatorPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const BackupPage = lazy(() => import('./pages/BackupPage'));

export default function App() {
  const loaded = useReminderStore((state) => state.loaded);
  const hydrate = useReminderStore((state) => state.hydrate);
  const location = useLocation();

  useEffect(() => {
    if (!loaded) void hydrate();
  }, [loaded, hydrate]);

  useNotificationScheduler();
  useServerSync();
  useCloudAutoBackup();

  return (
    <>
      <ErrorBoundary key={location.pathname}>
        <Suspense fallback={<div style={{ padding: 24, textAlign: 'center' }}>正在载入…</div>}>
          <ThemeController />
          <AppLockGate>
            <ServerStatusBar />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/reminder/new" element={<LunarGate><EditPage /></LunarGate>} />
              <Route path="/reminder/:id/edit" element={<LunarGate><EditPage /></LunarGate>} />
              <Route path="/reminder/:id" element={<LunarGate><DetailPage /></LunarGate>} />
              <Route path="/search" element={<LunarGate><SearchPage /></LunarGate>} />
              <Route path="/tags" element={<TagPage />} />
              <Route path="/calculator" element={<LunarGate><DateCalculatorPage /></LunarGate>} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/backup" element={<BackupPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppLockGate>
          <ServerLoginDialog />
        </Suspense>
      </ErrorBoundary>
      <UnhandledErrorNotice />
    </>
  );
}
