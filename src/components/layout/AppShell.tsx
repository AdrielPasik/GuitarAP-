import { NavLink, Outlet } from 'react-router-dom';
import { ThemeToggle } from '@/features/theme/ThemeToggle';
import { MetronomeControl } from '@/features/metronome/Metronome';

const navigation = [
  { to: '/biblioteca', label: 'Biblioteca', shortcut: 'B' },
  { to: '/tablaturas', label: 'Tablaturas', shortcut: 'T' },
  { to: '/diapason', label: 'Diapasón', shortcut: 'D' },
  { to: '/practica', label: 'Práctica', shortcut: 'P' },
];

export function AppShell() {
  return (
    <div className="min-h-screen bg-[#f7faf9] text-slate-800 transition-colors dark:bg-[#101816] dark:text-slate-100">
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur dark:border-white/10 dark:bg-[#15201d]/85 sm:px-6">
        <a className="flex items-center gap-3 font-semibold tracking-tight" href="/biblioteca">
          <span className="grid size-9 place-items-center rounded-xl bg-teal-700 text-lg text-white">
            ♫
          </span>
          GuitarAP
        </a>
        <div className="flex items-center gap-2">
          <MetronomeControl />
          <span className="hidden text-sm text-slate-500 dark:text-slate-400 sm:inline">
            Todo se guarda localmente por ahora
          </span>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)_260px]">
        <aside className="border-b border-slate-200/80 bg-white/45 px-3 py-3 dark:border-white/10 dark:bg-[#15201d]/35 md:min-h-[calc(100vh-4rem)] md:border-b-0 md:border-r md:px-4 md:py-6">
          <nav
            aria-label="Secciones principales"
            className="flex gap-1 overflow-x-auto md:flex-col"
          >
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex shrink-0 items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-teal-700 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-teal-50 hover:text-teal-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white'
                  }`
                }
              >
                <span>{item.label}</span>
                <kbd className="ml-5 hidden rounded border border-current/20 px-1.5 py-0.5 text-[10px] opacity-65 md:inline">
                  {item.shortcut}
                </kbd>
              </NavLink>
            ))}
          </nav>
          <NavLink
            to="/configuracion"
            className={({ isActive }) =>
              `mt-2 flex rounded-lg px-3 py-2.5 text-sm font-medium transition-colors md:mt-8 ${
                isActive
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-500 hover:bg-teal-50 hover:text-teal-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
              }`
            }
          >
            Configuración
          </NavLink>
        </aside>

        <main className="min-w-0 px-4 py-8 sm:px-7 sm:py-10">
          <Outlet />
        </main>

        <aside className="border-t border-slate-200/80 bg-white/45 p-4 dark:border-white/10 dark:bg-[#15201d]/35 lg:min-h-[calc(100vh-4rem)] lg:border-l lg:border-t-0 lg:p-6">
          <section
            aria-labelledby="sync-status"
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/5"
          >
            <p id="sync-status" className="text-sm font-semibold">
              Sincronización
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              Aún no configurada. Tus datos no salen de este dispositivo en F0.
            </p>
          </section>
          <section
            aria-labelledby="metronome-status"
            className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 dark:border-white/15"
          >
            <p id="metronome-status" className="text-sm font-semibold">
              Metrónomo
            </p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Disponible en F7.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
