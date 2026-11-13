import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ThemeContext } from '@/features/theme/theme-context';
import type { Theme } from '@/features/theme/theme-context';

const storageKey = 'guitarap.theme';

function readInitialTheme(): Theme {
  const storedTheme = window.localStorage.getItem(storageKey);
  return storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(storageKey, theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      toggleTheme: () => setTheme((currentTheme) => (currentTheme === 'light' ? 'dark' : 'light')),
    }),
    [theme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
