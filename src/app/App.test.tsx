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
    expect(screen.getByText('Sincronización')).toBeVisible();
    expect(screen.getByText('Metrónomo')).toBeVisible();
  });

  it('keeps navigation inside the working library until a document is selected', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('link', { name: /^Diapasón/ }));

    expect(await screen.findByRole('heading', { name: 'Biblioteca' })).toBeVisible();
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
