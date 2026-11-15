import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ThemeProvider } from '@/features/theme/ThemeProvider';
import { PwaRegistration } from '@/features/pwa/PwaRegistration';
import { MetronomeProvider } from '@/features/metronome/Metronome';

const LibraryScreen = lazy(() =>
  import('@/features/library/LibraryScreen').then((module) => ({ default: module.LibraryScreen })),
);
const TablatureScreen = lazy(() =>
  import('@/features/tablature/TablatureScreen').then((module) => ({
    default: module.TablatureScreen,
  })),
);
const FretboardScreen = lazy(() =>
  import('@/features/fretboard/FretboardScreen').then((module) => ({
    default: module.FretboardScreen,
  })),
);
const PracticeScreen = lazy(() =>
  import('@/features/practice/PracticeScreen').then((module) => ({
    default: module.PracticeScreen,
  })),
);
const RecoveryScreen = lazy(() =>
  import('@/features/library/RecoveryScreen').then((module) => ({
    default: module.RecoveryScreen,
  })),
);

function RouteFallback() {
  return <p className="p-6 text-sm text-slate-500">Cargando GuitarAP…</p>;
}

function deferred(element: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

export function App() {
  return (
    <ThemeProvider>
      <MetronomeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route index element={<Navigate replace to="/biblioteca" />} />
              <Route path="biblioteca" element={deferred(<LibraryScreen />)} />
              <Route path="tablaturas/:id" element={deferred(<TablatureScreen />)} />
              <Route path="diapason/:id" element={deferred(<FretboardScreen />)} />
              <Route path="tablaturas" element={<Navigate replace to="/biblioteca" />} />
              <Route path="diapason" element={<Navigate replace to="/biblioteca" />} />
              <Route path="practica" element={deferred(<PracticeScreen />)} />
              <Route path="configuracion" element={deferred(<RecoveryScreen />)} />
              <Route path="*" element={<Navigate replace to="/biblioteca" />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </MetronomeProvider>
      <PwaRegistration />
    </ThemeProvider>
  );
}
