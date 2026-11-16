import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Dialog } from '@/components/ui/Dialog';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      {open && (
        <Dialog title="Ejemplo" onClose={() => setOpen(false)}>
          <input aria-label="Campo" autoFocus />
        </Dialog>
      )}
    </>
  );
}

describe('Dialog', () => {
  it('focuses the first field, closes with Escape and gives focus back to what opened it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Abrir' });

    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'Ejemplo' })).toBeVisible();
    expect(screen.getByLabelText('Campo')).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.tab();
    await user.tab();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });
});
