import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PwaUpdateBanner } from '@/features/pwa/PwaRegistration';

describe('PwaUpdateBanner', () => {
  it('does not interrupt the session without an update', () => {
    const { container } = render(
      <PwaUpdateBanner needsRefresh={false} updateServiceWorker={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lets the person decide when to activate an update', async () => {
    const user = userEvent.setup();
    const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
    render(<PwaUpdateBanner needsRefresh updateServiceWorker={updateServiceWorker} />);

    await user.click(screen.getByRole('button', { name: 'Actualizar' }));

    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });
});

describe('an update never gets lost, and never gets forced', () => {
  it('speaks more firmly with the days, and never goes away by itself', async () => {
    const { noticeLevel, FIRM_AFTER_DAYS, URGENT_AFTER_DAYS } = await import('@/features/pwa/update-policy');
    expect(noticeLevel(0)).toBe('normal');
    expect(noticeLevel(FIRM_AFTER_DAYS - 1)).toBe('normal');
    expect(noticeLevel(FIRM_AFTER_DAYS)).toBe('firm');
    expect(noticeLevel(URGENT_AFTER_DAYS)).toBe('urgent');
    const { container, rerender } = render(<PwaUpdateBanner needsRefresh updateServiceWorker={vi.fn()} days={5} />);
    expect(container).toHaveTextContent('desde hace 5 días');
    rerender(<PwaUpdateBanner needsRefresh updateServiceWorker={vi.fn()} days={20} />);
    expect(container.querySelector('.update-banner.urgent')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeEnabled();
  });
  it('counts the days from the first time the update was seen, across reloads', async () => {
    const { daysWaiting } = await import('@/features/pwa/update-policy');
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    const day = 86_400_000;
    expect(daysWaiting(10 * day, storage)).toBe(0); // first sight
    expect(daysWaiting(13 * day, storage)).toBe(3);
    expect(daysWaiting(30 * day, storage)).toBe(20);
  });
  it('a tab whose code was replaced elsewhere says so and writes what is pending before reloading', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    render(<PwaUpdateBanner needsRefresh={false} updateServiceWorker={vi.fn()} staleTab reload={reload} />);
    expect(screen.getByRole('alert')).toHaveTextContent('se actualizó en otra pestaña');
    await user.click(screen.getByRole('button', { name: 'Recargar' }));
    expect(reload).toHaveBeenCalled();
  });
});
