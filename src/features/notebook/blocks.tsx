import type { DragEvent, ReactNode } from 'react';
import type { NotebookBlock } from '@/core/model';
import { Icon } from '@/components/ui/Icon';
import { blockMeta, type NewBlockKind } from '@/features/notebook/block-meta';
import { Menu, type MenuItem } from '@/components/ui/Popover';
import { CommentButton } from '@/features/notebook/comments';

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
        { label: 'Melodía', icon: 'melody', description: 'Notas con altura y duración', onSelect: () => onAdd('melody') },
        { label: 'Letra', icon: 'lyrics', description: 'Versos, estribillo, acordes sobre la letra', onSelect: () => onAdd('lyrics') },
        { label: 'Acordes', icon: 'chords', description: 'Una progresión: C G Am F', onSelect: () => onAdd('chords') },
        { separator: true },
        { label: 'Tablatura', icon: 'tab', onSelect: () => onAdd('tablature') },
        { label: 'Mapa del mástil', icon: 'map', onSelect: () => onAdd('map') },
        { separator: true },
        { label: 'Sección', icon: 'text', description: 'Agrupa los bloques que siguen (Verso 1, Estribillo, Solo…)', onSelect: () => onAdd('section') },
        { label: 'Título de sección', icon: 'text', onSelect: () => onAdd('heading') },
        { label: 'Nota de estudio', icon: 'text', onSelect: () => onAdd('note') },
      ]}
    />
  );
}

/**
 * Quiet frame around a musical block. Every block has a slim header that is always there: what it is, its
 * optional title, fold/unfold, and one menu with every action (move, duplicate, export, delete). The block
 * being worked on gets a thin accent edge. No card, no gutter icons to hunt for.
 */
export function BlockFrame({
  block,
  index,
  count,
  active,
  readOnly,
  collapsed,
  summary,
  onTitle,
  onMove,
  onDuplicate,
  onRemove,
  onToggleCollapse,
  onExport,
  onAddAfter,
  extraMenu,
  drag,
  badge,
  onBadge,
  children,
}: {
  block: NotebookBlock;
  index: number;
  count: number;
  active: boolean;
  readOnly: boolean;
  collapsed: boolean;
  summary: string;
  onTitle: (title: string) => void;
  onMove: (offset: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onToggleCollapse: () => void;
  onExport?: () => void;
  onAddAfter: (kind: NewBlockKind) => void;
  /** Extra actions (move to a section, move or copy to another song, link lyrics…) placed before Delete. */
  extraMenu?: MenuItem[];
  /** Drag and drop reordering. Never the only way: the menu and Alt+arrows do the same. */
  drag?: {
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
    edge: 'before' | 'after' | null;
    dragging: boolean;
  };
  /** A small text next to the title (for example "con la letra «Verso 1»"). */
  badge?: string;
  /** Makes the badge a button (e.g. «con su letra» opens the joint view). */
  onBadge?: () => void;
  children: ReactNode;
}) {
  const meta = blockMeta[block.kind] ?? { label: 'Bloque de otra versión', icon: 'text' as const };
  const title = block.kind === 'text' ? '' : (block.title ?? '');
  const isText = block.kind === 'text';
  return (
    <section
      id={`block-${block.id}`}
      className={`block kind-${block.kind}${active ? ' active' : ''}${collapsed ? ' collapsed' : ''}${drag?.dragging ? ' dragging' : ''}${drag?.edge ? ` drop-${drag.edge}` : ''}`}
      aria-label={`${meta.label} ${index + 1}${title ? `: ${title}` : ''}`}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
    >
      {(!isText || !readOnly) && (
        <header className={`block-head${isText ? ' text' : ''}`}>
          {!isText && !readOnly && drag && (
            <button
              type="button"
              className="icon-btn grip nb-chrome"
              draggable
              aria-label={`Reordenar ${meta.label.toLowerCase()} ${index + 1}`}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              title="Arrastrar para reordenar (o Alt + flecha arriba o abajo)"
              onDragStart={drag.onDragStart}
              onDragEnd={drag.onDragEnd}
              onKeyDown={(event) => {
                if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                  event.preventDefault();
                  onMove(event.key === 'ArrowUp' ? -1 : 1);
                }
              }}
            >
              <Icon name="grip" size={14} />
            </button>
          )}
          {!isText && (
            <>
              <span className="block-kind" title={meta.label}>
                <Icon name={meta.icon} size={15} />
              </span>
              <input
                className="block-title"
                aria-label={`Título de ${meta.label.toLowerCase()} ${index + 1}`}
                placeholder={meta.label}
                readOnly={readOnly}
                value={title}
                onChange={(event) => onTitle(event.target.value)}
              />
              {badge && (onBadge ? (
                <button type="button" className="block-badge link" title="Abrir la vista Letra + melodía" onClick={onBadge}>{badge} →</button>
              ) : (
                <span className="block-badge">{badge}</span>
              ))}
              {collapsed && <span className="block-summary">{summary}</span>}
            </>
          )}
          <span className="spacer" />
          {!isText && <CommentButton blockId={block.id} label={`${meta.label.toLowerCase()} ${index + 1}`} />}
          {!readOnly && (
            <div className="block-tools nb-chrome">
              {!isText && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={collapsed ? `Expandir ${meta.label.toLowerCase()} ${index + 1}` : `Plegar ${meta.label.toLowerCase()} ${index + 1}`}
                  aria-expanded={!collapsed}
                  onClick={onToggleCollapse}
                >
                  <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={15} />
                </button>
              )}
              <Menu
                label={`Acciones de ${meta.label.toLowerCase()} ${index + 1}`}
                align="end"
                triggerClassName="icon-btn"
                trigger={<Icon name="more" />}
                items={[
                  { label: 'Subir', icon: 'arrow-up', disabled: index === 0, onSelect: () => onMove(-1) },
                  { label: 'Bajar', icon: 'arrow-down', disabled: index === count - 1, onSelect: () => onMove(1) },
                  { label: 'Duplicar', icon: 'copy', onSelect: onDuplicate },
                  ...(onExport ? [{ label: 'Exportar este bloque…', icon: 'export' as const, onSelect: onExport }] : []),
                  ...(extraMenu?.length ? [{ separator: true as const }, ...extraMenu] : []),
                  { separator: true as const },
                  { label: 'Eliminar bloque', icon: 'trash', danger: true, onSelect: onRemove },
                ]}
              />
            </div>
          )}
        </header>
      )}
      {!collapsed && <div className="block-body">{children}</div>}
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

/**
 * A section is a named group of blocks. Its header is editorial (a large title, a hairline) rather than a card,
 * and it carries the actions for the whole group: fold, move up or down, duplicate, delete.
 */
export function SectionHeader({
  block,
  index,
  count,
  sectionCount,
  readOnly,
  collapsed,
  blocksInside,
  onTitle,
  onToggle,
  onMoveSection,
  onDuplicate,
  onRemove,
  onAddInside,
}: {
  block: Extract<NotebookBlock, { kind: 'section' }>;
  index: number;
  count: number;
  sectionCount: number;
  readOnly: boolean;
  collapsed: boolean;
  blocksInside: number;
  onTitle: (title: string) => void;
  onToggle: () => void;
  onMoveSection: (offset: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: (withContent: boolean) => void;
  onAddInside: (kind: NewBlockKind) => void;
}) {
  void count;
  return (
    <section id={`block-${block.id}`} className={`section-head${collapsed ? ' collapsed' : ''}`} aria-label={`Sección ${block.title || index + 1}`}>
      <button type="button" className="icon-btn" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expandir' : 'Plegar'} la sección ${block.title || ''}`.trim()} onClick={onToggle}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} />
      </button>
      {readOnly ? (
        <h2 className="section-title static">{block.title || 'Sección'}</h2>
      ) : (
        <input
          className="section-title"
          aria-label={`Nombre de la sección ${index + 1}`}
          placeholder="Nombre de la sección: Verso 1, Estribillo, Solo…"
          value={block.title}
          onChange={(event) => onTitle(event.target.value)}
        />
      )}
      {collapsed && <span className="block-summary">{blocksInside} {blocksInside === 1 ? 'bloque' : 'bloques'}</span>}
      <span className="spacer" />
      {!readOnly && (
        <div className="block-tools nb-chrome">
          <AddBlockMenu label={`Agregar bloque a la sección ${block.title || ''}`.trim()} triggerClassName="icon-btn" align="end" onAdd={onAddInside}>
            <Icon name="plus" size={15} />
          </AddBlockMenu>
          <Menu
            label={`Acciones de la sección ${block.title || index + 1}`}
            align="end"
            triggerClassName="icon-btn"
            trigger={<Icon name="more" />}
            items={[
              { label: 'Subir la sección', icon: 'arrow-up', disabled: sectionCount < 2, onSelect: () => onMoveSection(-1) },
              { label: 'Bajar la sección', icon: 'arrow-down', disabled: sectionCount < 2, onSelect: () => onMoveSection(1) },
              { label: 'Duplicar la sección', icon: 'copy', onSelect: onDuplicate },
              { separator: true },
              { label: 'Eliminar solo el encabezado', description: 'Los bloques quedan donde están', icon: 'trash', onSelect: () => onRemove(false) },
              { label: 'Eliminar la sección y su contenido', icon: 'trash', danger: true, onSelect: () => onRemove(true) },
            ]}
          />
        </div>
      )}
    </section>
  );
}
