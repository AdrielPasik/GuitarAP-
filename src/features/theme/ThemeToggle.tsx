import { useContext } from 'react';
import { Icon } from '@/components/ui/Icon';
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
      title={`Modo ${nextTheme}`}
      className="icon-btn"
      onClick={context.toggleTheme}
    >
      <Icon name={context.theme === 'light' ? 'moon' : 'sun'} />
    </button>
  );
}
