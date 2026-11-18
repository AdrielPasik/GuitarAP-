import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '@/app/App';

describe('App', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/biblioteca');
  });

  it('renders the shell with identity, navigation and the metronome', async () => {
    render(<App />);

    expect(screen.getByRole('banner')).toHaveTextContent('GuitarAP');
    expect(await screen.findByRole('heading', { name: 'Biblioteca' }, { timeout: 6000 })).toBeVisible();
    expect(screen.getByLabelText('BPM')).toBeVisible();
    expect(screen.getByRole('link', { name: /^Práctica/ })).toBeVisible();
  });

  it('always shows how to sign in and says the work is only on this device', async () => {
    render(<App />);

    expect(await screen.findByRole('button', { name: /Iniciar sesión/ })).toBeVisible();
    expect(screen.getAllByText('Solo en este dispositivo').length).toBeGreaterThan(0);
  });

  it('opens practice from the primary navigation', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('link', { name: /^Práctica/ }));

    // The Practice screen is a lazily loaded chunk: its first import is slow under parallel load, so the test waits longer.
    expect(await screen.findByRole('region', { name: 'Modo Práctica' }, { timeout: 15000 })).toBeVisible();
  }, 30_000);

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
