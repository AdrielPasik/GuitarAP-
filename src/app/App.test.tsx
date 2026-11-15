import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '@/app/App';

describe('App', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/biblioteca');
  });

  it('renders the application shell and initial section', async () => {
    render(<App />);

    expect(screen.getByRole('banner')).toHaveTextContent('GuitarAP');
    expect(await screen.findByRole('heading', { name: 'Biblioteca' })).toBeVisible();
    expect(screen.getByText(/Guardado local · sin nube configurada|Sincronización disponible en Configuración/)).toBeVisible();
    expect(screen.getByLabelText('BPM')).toBeVisible();
  });

  it('opens practice from the compact primary navigation', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('link', { name: /^Práctica/ }));

    expect(await screen.findByRole('heading', { name: 'Modo Práctica' })).toBeVisible();
  });

  it('changes theme and persists the preference', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Activar modo oscuro' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem('guitarap.theme')).toBe('dark');
  });

  it('restores a persisted theme', () => {
    window.localStorage.setItem('guitarap.theme', 'dark');
    render(<App />);

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});
