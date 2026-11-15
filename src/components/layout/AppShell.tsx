import { NavLink, Outlet } from 'react-router-dom';
import { ThemeToggle } from '@/features/theme/ThemeToggle';
import { MetronomeControl } from '@/features/metronome/Metronome';
import { configuredSupabase } from '@/features/sync/supabase-auth';

const navigation = [
  { to: '/biblioteca', label: 'Biblioteca', shortcut: 'B', icon: '▤' },
  { to: '/practica', label: 'Práctica', shortcut: 'P', icon: '▶' },
];

export function AppShell() {
  const cloudLabel = configuredSupabase()
    ? 'Sincronización disponible en Configuración'
    : 'Guardado local · sin nube configurada';
  return (
    <div className="min-h-screen bg-[#f5f7f8] text-slate-800 transition-colors dark:bg-[#11181e] dark:text-slate-100">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-white/10 dark:bg-[#182229]/90 sm:px-6">
        <a className="flex items-center gap-3 font-semibold tracking-tight" href="/biblioteca">
          <span className="grid size-8 place-items-center rounded-lg bg-[#1d6b86] text-lg text-white">
            ♫
          </span>
          GuitarAP
        </a>
        <div className="flex items-center gap-2">
          <MetronomeControl />
          <span className="cloud-status hidden text-sm text-slate-500 dark:text-slate-400 lg:inline">
            {cloudLabel}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto grid max-w-[1700px] grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200/80 bg-white/45 px-3 py-3 dark:border-white/10 dark:bg-[#182229]/35 md:min-h-[calc(100vh-3.5rem)] md:border-b-0 md:border-r md:px-3 md:py-5">
          <nav
            aria-label="Secciones principales"
            className="flex gap-1 overflow-x-auto md:flex-col"
          >
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                aria-label={item.label}
                className={({ isActive }) =>
                  `flex shrink-0 items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#1d6b86] text-white shadow-sm'
                      : 'text-slate-600 hover:bg-sky-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white'
                  }`
                }
              >
                <span className="flex items-center gap-2">
                  <i className="text-xs opacity-75">{item.icon}</i>
                  {item.label}
                </span>
                <kbd className="ml-5 hidden rounded border border-current/20 px-1.5 py-0.5 text-[10px] opacity-65 md:inline">
                  {item.shortcut}
                </kbd>
              </NavLink>
            ))}
          </nav>
          <NavLink
            to="/configuracion"
            aria-label="Configuración"
            className={({ isActive }) =>
              `mt-2 flex rounded-lg px-3 py-2.5 text-sm font-medium transition-colors md:mt-8 ${
                isActive
                  ? 'bg-[#1d6b86] text-white'
                  : 'text-slate-500 hover:bg-sky-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
              }`
            }
          >
            <span className="flex items-center gap-2">
              <i className="text-xs opacity-75">⚙</i>Configuración
            </span>
          </NavLink>
        </aside>

        <main className="min-w-0 px-4 py-5 sm:px-7 sm:py-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
