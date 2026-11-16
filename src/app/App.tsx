import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ToastProvider } from '@/components/ui/Toast';
import { AccountProvider } from '@/features/account/AccountProvider';
import { MetronomeProvider } from '@/features/metronome/Metronome';
import { PwaRegistration } from '@/features/pwa/PwaRegistration';
import { ThemeProvider } from '@/features/theme/ThemeProvider';

const LibraryScreen = lazy(() =>
  import('@/features/library/LibraryScreen').then((module) => ({ default: module.LibraryScreen })),
);
const NotebookScreen = lazy(() =>
  import('@/features/notebook/NotebookScreen').then((module) => ({ default: module.NotebookScreen })),
);
const PracticeScreen = lazy(() =>
  import('@/features/practice/PracticeScreen').then((module) => ({ default: module.PracticeScreen })),
);
const SettingsScreen = lazy(() =>
  import('@/features/settings/SettingsScreen').then((module) => ({ default: module.SettingsScreen })),
);

function RouteFallback() {
  return (
    <p className="route-fallback" role="status">
      Cargando…
    </p>
  );
}

function deferred(element: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <MetronomeProvider>
          <BrowserRouter>
            <AccountProvider>
              <Routes>
                <Route path="/" element={<AppShell />}>
                  <Route index element={<Navigate replace to="/biblioteca" />} />
                  <Route path="biblioteca" element={deferred(<LibraryScreen />)} />
                  <Route path="material/:id" element={deferred(<NotebookScreen />)} />
                  {/* Links saved before notebooks keep working. */}
                  <Route path="tablaturas/:id" element={deferred(<NotebookScreen />)} />
                  <Route path="diapason/:id" element={deferred(<NotebookScreen />)} />
                  <Route path="tablaturas" element={<Navigate replace to="/biblioteca" />} />
                  <Route path="diapason" element={<Navigate replace to="/biblioteca" />} />
                  <Route path="practica" element={deferred(<PracticeScreen />)} />
                  <Route path="practica/:id" element={deferred(<PracticeScreen />)} />
                  <Route path="configuracion" element={deferred(<SettingsScreen />)} />
                  <Route path="configuracion/:section" element={deferred(<SettingsScreen />)} />
                  <Route path="*" element={<Navigate replace to="/biblioteca" />} />
                </Route>
              </Routes>
            </AccountProvider>
          </BrowserRouter>
        </MetronomeProvider>
      </ToastProvider>
      <PwaRegistration />
    </ThemeProvider>
  );
}
