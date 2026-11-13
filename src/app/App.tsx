import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { PlaceholderScreen } from '@/components/ui/PlaceholderScreen';
import { ThemeProvider } from '@/features/theme/ThemeProvider';
import { PwaRegistration } from '@/features/pwa/PwaRegistration';

const screens = {
  biblioteca: {
    title: 'Biblioteca',
    description: 'Tus documentos y carpetas vivirán aquí en una fase posterior.',
  },
  tablaturas: {
    title: 'Tablaturas',
    description: 'El editor de tablaturas se incorporará después de las fundaciones.',
  },
  diapason: {
    title: 'Diapasón',
    description: 'El estudio visual del mástil está planificado para F5 y F6.',
  },
  practica: {
    title: 'Práctica',
    description: 'La práctica con metrónomo llegará en F7.',
  },
  configuracion: {
    title: 'Configuración',
    description: 'Las preferencias de cuenta y datos estarán disponibles más adelante.',
  },
};

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<Navigate replace to="/biblioteca" />} />
            {Object.entries(screens).map(([path, screen]) => (
              <Route key={path} path={path} element={<PlaceholderScreen {...screen} />} />
            ))}
            <Route path="*" element={<Navigate replace to="/biblioteca" />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <PwaRegistration />
    </ThemeProvider>
  );
}
