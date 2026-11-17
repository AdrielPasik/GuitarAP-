import { useMemo, useState } from 'react';
import type { NotebookContent } from '@/core/model';
import { isTextual, sectionsOf, textOf } from '@/core/notebook';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { pathOf } from '@/data/paths';
import { useLibrary } from '@/data/use-library';

export type TransferMode = 'move' | 'copy';
const verb = (mode: TransferMode) => (mode === 'move' ? 'Mover' : 'Copiar');

/** Where inside this song a block goes: the end of a section, or the very end. */
export function SectionPickerDialog({ notebook, label, onPick, onClose }: { notebook: NotebookContent; label: string; onPick: (sectionId: string | null) => void; onClose: () => void }) {
  const sections = sectionsOf(notebook);
  return (
    <Dialog title={`Mover «${label}» a otra sección`} size="sm" onClose={onClose}>
      <ul className="picker-list" aria-label="Secciones">
        {sections.map((section) => (
          <li key={section.id}>
            <button type="button" className="picker-row" onClick={() => onPick(section.id)}>
              <Icon name="index" size={15} />
              <span className="picker-title">{section.title || 'Sección sin nombre'}</span>
              <span className="muted small">al final de la sección</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="picker-row" onClick={() => onPick(null)}>
            <Icon name="arrow-down" size={15} />
            <span className="picker-title">Al final del cuaderno</span>
          </button>
        </li>
      </ul>
    </Dialog>
  );
}

/**
 * Choose another song or notebook to move or copy a block into. It lists only your own materials, with their
 * folder path, and a search box once there are many. Moving writes the destination first and removes the block
 * here only after that was saved.
 */
export function DocumentPickerDialog({
  mode,
  label,
  currentId,
  onPick,
  onClose,
}: {
  mode: TransferMode;
  label: string;
  currentId: string;
  onPick: (documentId: string, title: string) => void;
  onClose: () => void;
}) {
  const { nodes, documents } = useLibrary();
  const [query, setQuery] = useState('');
  const text = query.trim().toLocaleLowerCase();
  const shown = useMemo(
    () =>
      documents
        .filter((item) => item.id !== currentId)
        .filter((item) => !text || item.title.toLocaleLowerCase().includes(text) || pathOf(nodes, item.songId ?? item.nodeId).toLocaleLowerCase().includes(text))
        .slice(0, 60),
    [documents, nodes, currentId, text],
  );
  return (
    <Dialog title={`${verb(mode)} «${label}» a…`} size="md" onClose={onClose}>
      <div className="stack">
        <p className="muted small">
          {mode === 'move'
            ? 'El bloque se quita de esta canción solo después de quedar guardado en la otra. Podés deshacerlo desde el aviso.'
            : 'Se crea una copia independiente (con identificadores nuevos). El original no cambia.'}
        </p>
        {documents.length > 6 && (
          <input type="search" aria-label="Buscar canción o cuaderno de destino" placeholder="Buscar destino…" value={query} onChange={(event) => setQuery(event.target.value)} />
        )}
        <ul className="picker-list" aria-label="Destinos">
          {shown.map((item) => (
            <li key={item.id}>
              <button type="button" className="picker-row" onClick={() => onPick(item.id, item.title || 'Sin título')}>
                <Icon name="song" size={15} />
                <span className="picker-title">{item.title || 'Sin título'}</span>
                <span className="muted small">{pathOf(nodes, item.songId ?? item.nodeId) || 'Biblioteca'}</span>
              </button>
            </li>
          ))}
          {!shown.length && <li className="muted small pad">{documents.length <= 1 ? 'No hay otra canción o cuaderno todavía. Creá uno desde la biblioteca.' : 'Sin resultados.'}</li>}
        </ul>
      </div>
    </Dialog>
  );
}

/** Where a selected piece of text goes inside this song: another writing block, or a new one. */
export function TextTransferDialog({
  mode,
  notebook,
  fromBlockId,
  preview,
  onPick,
  onClose,
}: {
  mode: TransferMode;
  notebook: NotebookContent;
  fromBlockId: string;
  preview: string;
  onPick: (target: { blockId: string } | { create: 'lyrics' | 'note' }) => void;
  onClose: () => void;
}) {
  const targets = notebook.blocks.filter((block) => isTextual(block) && block.id !== fromBlockId);
  const sectionTitle = (id: string) => {
    const index = notebook.blocks.findIndex((block) => block.id === id);
    for (let at = index; at >= 0; at -= 1) {
      const block = notebook.blocks[at];
      if (block.kind === 'section') return block.title || 'Sección';
    }
    return '';
  };
  return (
    <Dialog title={`${verb(mode)} el texto seleccionado a…`} size="md" onClose={onClose}>
      <div className="stack">
        <blockquote className="picker-preview">{preview.length > 160 ? `${preview.slice(0, 160)}…` : preview}</blockquote>
        <ul className="picker-list" aria-label="Bloques de destino">
          {targets.map((block) => (
            <li key={block.id}>
              <button type="button" className="picker-row" onClick={() => onPick({ blockId: block.id })}>
                <Icon name={block.kind === 'lyrics' ? 'lyrics' : 'text'} size={15} />
                <span className="picker-title">
                  {block.kind === 'lyrics' ? 'Letra' : 'Nota'}
                  {block.kind === 'lyrics' || block.kind === 'text' ? (textOf(block).trim() ? `: ${textOf(block).trim().split('\n').find((line) => !line.startsWith('#'))?.slice(0, 36) ?? ''}` : ' (vacía)') : ''}
                </span>
                <span className="muted small">{sectionTitle(block.id)}</span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="picker-row" onClick={() => onPick({ create: 'lyrics' })}>
              <Icon name="plus" size={15} />
              <span className="picker-title">Un bloque de Letra nuevo</span>
            </button>
          </li>
          <li>
            <button type="button" className="picker-row" onClick={() => onPick({ create: 'note' })}>
              <Icon name="plus" size={15} />
              <span className="picker-title">Una nota nueva</span>
            </button>
          </li>
        </ul>
      </div>
    </Dialog>
  );
}

/** A short list of blocks to choose from (used to link a melody with a lyrics block). */
export function BlockChoiceDialog({
  title,
  hint,
  options,
  createLabel,
  onPick,
  onCreate,
  onClose,
}: {
  title: string;
  hint: string;
  options: Array<{ id: string; label: string; hint: string }>;
  createLabel: string;
  onPick: (id: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} size="md" onClose={onClose}>
      <div className="stack">
        <p className="muted small">{hint}</p>
        <ul className="picker-list" aria-label="Letras disponibles">
          {options.map((option) => (
            <li key={option.id}>
              <button type="button" className="picker-row" onClick={() => onPick(option.id)}>
                <Icon name="lyrics" size={15} />
                <span className="picker-title">{option.label}</span>
                <span className="muted small">{option.hint}</span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="picker-row" onClick={onCreate}>
              <Icon name="plus" size={15} />
              <span className="picker-title">{createLabel}</span>
            </button>
          </li>
        </ul>
      </div>
    </Dialog>
  );
}
