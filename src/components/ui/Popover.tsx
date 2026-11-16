import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

/** Closes on outside pointer, Escape and focus leaving; returns focus to the trigger on Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      root.current?.querySelector<HTMLElement>('[data-popover-trigger]')?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return { open, setOpen, close, root };
}

export type MenuItem =
  | { separator: true }
  | {
      label: string;
      onSelect: () => void;
      icon?: IconName;
      checked?: boolean;
      danger?: boolean;
      disabled?: boolean;
      hint?: string;
    };

export function Popover({
  trigger,
  label,
  align = 'start',
  triggerClassName = 'btn btn-ghost',
  children,
}: {
  trigger: ReactNode;
  label: string;
  align?: 'start' | 'end';
  triggerClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const { open, setOpen, close, root } = usePopover();
  const id = useId();
  return (
    <div className="popover" ref={root}>
      <button
        type="button"
        data-popover-trigger
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open && (
        <div id={id} role="dialog" aria-label={label} className={`popover-panel align-${align}`}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function Menu({
  trigger,
  label,
  items,
  align = 'start',
  triggerClassName = 'btn btn-ghost',
}: {
  trigger: ReactNode;
  label: string;
  items: MenuItem[];
  align?: 'start' | 'end';
  triggerClassName?: string;
}) {
  const { open, setOpen, close, root } = usePopover();
  const id = useId();
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open, root]);
  function navigate(event: React.KeyboardEvent) {
    const focusable = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') focusable[(index + 1) % focusable.length]?.focus();
    else if (event.key === 'ArrowUp') focusable[(index - 1 + focusable.length) % focusable.length]?.focus();
    else if (event.key === 'Home') focusable[0]?.focus();
    else if (event.key === 'End') focusable.at(-1)?.focus();
    else return;
    event.preventDefault();
  }
  return (
    <div className="popover" ref={root}>
      <button
        type="button"
        data-popover-trigger
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open && (
        <div id={id} role="menu" aria-label={label} className={`popover-panel menu align-${align}`} onKeyDown={navigate}>
          {items.map((item, index) =>
            'separator' in item ? (
              <hr key={`sep-${index}`} role="separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                disabled={item.disabled}
                className={`menu-item${item.danger ? ' danger' : ''}`}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                <span className="menu-icon">
                  {item.checked ? <Icon name="check" size={14} /> : item.icon ? <Icon name={item.icon} size={14} /> : null}
                </span>
                <span className="menu-label">{item.label}</span>
                {item.hint && <kbd>{item.hint}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
