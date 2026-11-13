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
