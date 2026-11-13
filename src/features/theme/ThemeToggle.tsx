import { useContext } from 'react';
import { ThemeContext } from '@/features/theme/theme-context';

export function ThemeToggle() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('ThemeToggle debe usarse dentro de ThemeProvider.');

  const nextTheme = context.theme === 'light' ? 'oscuro' : 'claro';

  return (
    <button
      type="button"
      aria-label={`Activar modo ${nextTheme}`}
      aria-pressed={context.theme === 'dark'}
      className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-teal-300 hover:text-teal-800 dark:border-white/15 dark:text-slate-200 dark:hover:border-teal-400 dark:hover:text-teal-200"
      onClick={context.toggleTheme}
    >
      {context.theme === 'light' ? 'Oscuro' : 'Claro'}
    </button>
  );
}
