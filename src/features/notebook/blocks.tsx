import type { ReactNode } from 'react';
import type { NotebookBlock } from '@/core/model';
import { Icon } from '@/components/ui/Icon';
import { blockMeta, type NewBlockKind } from '@/features/notebook/block-meta';
import { Menu } from '@/components/ui/Popover';

export function AddBlockMenu({
  onAdd,
  label = 'Agregar bloque',
  triggerClassName = 'btn',
  children,
  align = 'start',
}: {
  onAdd: (kind: NewBlockKind) => void;
  label?: string;
  triggerClassName?: string;
  children?: ReactNode;
  align?: 'start' | 'end';
}) {
  return (
    <Menu
      label={label}
      align={align}
      triggerClassName={triggerClassName}
      trigger={children ?? (
        <>
          <Icon name="plus" size={14} /> {label}
        </>
      )}
      items={[
        { label: 'Tablatura', icon: 'tab', onSelect: () => onAdd('tablature') },
        { label: 'Mapa del mástil', icon: 'map', onSelect: () => onAdd('map') },
        { separator: true },
        { label: 'Título de sección', icon: 'text', onSelect: () => onAdd('heading') },
        { label: 'Nota de estudio', icon: 'text', onSelect: () => onAdd('note') },
      ]}
    />
  );
}

/** Quiet frame around a musical block: a title when it has one, actions on hover or focus. No card. */
export function BlockFrame({
  block,
  index,
  count,
  active,
  readOnly,
  onTitle,
  onMove,
  onDuplicate,
  onRemove,
  onAddAfter,
  children,
}: {
  block: NotebookBlock;
  index: number;
  count: number;
  active: boolean;
  readOnly: boolean;
  onTitle: (title: string) => void;
  onMove: (offset: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onAddAfter: (kind: NewBlockKind) => void;
  children: ReactNode;
}) {
  const meta = blockMeta[block.kind];
  const title = block.kind === 'text' ? '' : (block.title ?? '');
  return (
    <section
      id={`block-${block.id}`}
      className={`block kind-${block.kind}${active ? ' active' : ''}`}
      aria-label={`${meta.label} ${index + 1}${title ? `: ${title}` : ''}`}
    >
      {!readOnly && (
        <div className="block-actions nb-chrome" role="group" aria-label={`Acciones de ${meta.label.toLowerCase()} ${index + 1}`}>
          <span className="block-kind" title={meta.label}>
            <Icon name={meta.icon} size={15} />
          </span>
          <button type="button" className="icon-btn" aria-label="Subir bloque" disabled={index === 0} onClick={() => onMove(-1)}>
            <Icon name="arrow-up" size={14} />
          </button>
          <button type="button" className="icon-btn" aria-label="Bajar bloque" disabled={index === count - 1} onClick={() => onMove(1)}>
            <Icon name="arrow-down" size={14} />
          </button>
          <button type="button" className="icon-btn" aria-label="Duplicar bloque" onClick={onDuplicate}>
            <Icon name="copy" size={14} />
          </button>
          <button type="button" className="icon-btn danger" aria-label="Eliminar bloque" onClick={onRemove}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      )}
      {block.kind !== 'text' && (!readOnly || title) && (
        <input
          className="block-title"
          aria-label={`Título de ${meta.label.toLowerCase()} ${index + 1}`}
          placeholder={`${meta.label} sin título`}
          readOnly={readOnly}
          value={title}
          onChange={(event) => onTitle(event.target.value)}
        />
      )}
      {children}
      {!readOnly && (
        <div className="add-between nb-chrome">
          <AddBlockMenu label={`Agregar bloque después del bloque ${index + 1}`} triggerClassName="add-between-btn" onAdd={onAddAfter}>
            <Icon name="plus" size={14} />
          </AddBlockMenu>
        </div>
      )}
    </section>
  );
}

export function TextBlock({
  block,
  readOnly,
  onChange,
}: {
  block: Extract<NotebookBlock, { kind: 'text' }>;
  readOnly: boolean;
  onChange: (change: { text: string }) => void;
}) {
  if (readOnly) {
    // Reading view: plain text, not form fields.
    return block.style === 'heading' ? (
      <h3 className="text-heading static">{block.text}</h3>
    ) : block.text.trim() ? (
      <p className="text-note static">{block.text}</p>
    ) : null;
  }
  if (block.style === 'heading') {
    return (
      <input
        className="text-heading"
        aria-label="Título de sección"
        placeholder="Título de sección: Intro, Escala, Solo…"
        readOnly={readOnly}
        value={block.text}
        onChange={(event) => onChange({ text: event.target.value })}
      />
    );
  }
  return (
    <textarea
      className="text-note"
      aria-label="Nota de estudio"
      placeholder="Escribí una indicación de estudio: tempo, digitación, qué escuchar…"
      readOnly={readOnly}
      rows={2}
      value={block.text}
      onChange={(event) => onChange({ text: event.target.value })}
    />
  );
}
