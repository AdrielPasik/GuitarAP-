import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ThemeProvider } from '@/features/theme/ThemeProvider';
import { PwaRegistration } from '@/features/pwa/PwaRegistration';
import { LibraryScreen } from '@/features/library/LibraryScreen';
import { TablatureScreen } from '@/features/tablature/TablatureScreen';
import { FretboardScreen } from '@/features/fretboard/FretboardScreen';
import { MetronomeProvider } from '@/features/metronome/Metronome';
import { PracticeScreen } from '@/features/practice/PracticeScreen';
import { RecoveryScreen } from '@/features/library/RecoveryScreen';

export function App() {
  return (
    <ThemeProvider>
      <MetronomeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<Navigate replace to="/biblioteca" />} />
            <Route path="biblioteca" element={<LibraryScreen />} />
            <Route path="tablaturas/:id" element={<TablatureScreen />} />
            <Route path="diapason/:id" element={<FretboardScreen />} />
            <Route path="tablaturas" element={<Navigate replace to="/biblioteca" />} />
            <Route path="diapason" element={<Navigate replace to="/biblioteca" />} />
            <Route path="practica" element={<PracticeScreen />} />
            <Route path="configuracion" element={<RecoveryScreen />} />
            <Route path="*" element={<Navigate replace to="/biblioteca" />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </MetronomeProvider>
      <PwaRegistration />
    </ThemeProvider>
  );
}
