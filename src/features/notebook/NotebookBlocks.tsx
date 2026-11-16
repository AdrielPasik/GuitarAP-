import { useState } from 'react';
import type { NotebookContent } from '@/core/model';
import {
  duplicateBlock,
  insertBlock,
  moveBlock,
  removeBlock,
  updateBlock,
} from '@/core/notebook';
import { useToast } from '@/components/ui/toast-context';
import { MapBlock } from '@/features/fretboard/MapBlock';
import { AddBlockMenu, BlockFrame, TextBlock } from '@/features/notebook/blocks';
import { blockFor, type NewBlockKind } from '@/features/notebook/block-meta';
import { TabBlock } from '@/features/tablature/TabBlock';

type Change = (update: (notebook: NotebookContent) => NotebookContent) => void;

/**
 * The ordered blocks of a notebook. Used to edit (readOnly = false) and to read in practice mode;
 * both render exactly the same music.
 */
export function NotebookBlocks({
  notebook,
  change,
  undo,
  readOnly = false,
}: {
  notebook: NotebookContent;
  change?: Change;
  undo?: () => void;
  readOnly?: boolean;
}) {
  const toast = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const edit: Change = change ?? (() => undefined);

  function addAfter(index: number, kind: NewBlockKind) {
    const block = blockFor(kind);
    edit((current) => insertBlock(current, block, index));
    setActiveId(block.id);
    requestAnimationFrame(() => document.getElementById(`block-${block.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  return (
    <div className="blocks">
      {notebook.blocks.map((block, index) => (
        <BlockFrame
          key={block.id}
          block={block}
          index={index}
          count={notebook.blocks.length}
          active={activeId === block.id}
          readOnly={readOnly}
          onTitle={(title) => edit((current) => updateBlock(current, block.id, (item) => (item.kind === 'text' ? item : { ...item, title })))}
          onMove={(offset) => edit((current) => moveBlock(current, block.id, offset))}
          onDuplicate={() => edit((current) => duplicateBlock(current, block.id))}
          onRemove={() => {
            edit((current) => removeBlock(current, block.id));
            toast.show('Bloque eliminado.', undo ? { label: 'Deshacer', onAction: undo } : undefined);
          }}
          onAddAfter={(kind) => addAfter(index, kind)}
        >
          {block.kind === 'tablature' && (
            <TabBlock
              blockId={block.id}
              content={block.content}
              readOnly={readOnly}
              active={activeId === block.id || notebook.blocks.length === 1}
              onActivate={() => setActiveId(block.id)}
              onChange={(update) =>
                edit((current) => updateBlock(current, block.id, (item) => (item.kind === 'tablature' ? { ...item, content: update(item.content) } : item)))
              }
            />
          )}
          {block.kind === 'map' && (
            <div onFocusCapture={() => setActiveId(block.id)} onPointerDownCapture={() => setActiveId(block.id)}>
              <MapBlock
                content={block.content}
                readOnly={readOnly}
                onChange={(update) =>
                  edit((current) => updateBlock(current, block.id, (item) => (item.kind === 'map' ? { ...item, content: update(item.content) } : item)))
                }
              />
            </div>
          )}
          {block.kind === 'text' && (
            <TextBlock
              block={block}
              readOnly={readOnly}
              onChange={(patch) => edit((current) => updateBlock(current, block.id, (item) => (item.kind === 'text' ? { ...item, ...patch } : item)))}
            />
          )}
        </BlockFrame>
      ))}
      {!readOnly && notebook.blocks.length === 0 && (
        <div className="empty-notebook">
          <h2>Este material está vacío</h2>
          <p>Empezá con lo que necesites. Podés combinar varios bloques en el mismo material.</p>
          <div className="empty-actions">
            <button type="button" className="btn btn-primary" onClick={() => addAfter(-1, 'map')}>
              Mapa del mástil
            </button>
            <button type="button" className="btn" onClick={() => addAfter(-1, 'tablature')}>
              Tablatura
            </button>
            <button type="button" className="btn" onClick={() => addAfter(-1, 'note')}>
              Nota de estudio
            </button>
          </div>
        </div>
      )}
      {!readOnly && notebook.blocks.length > 0 && (
        <div className="add-end nb-chrome">
          <AddBlockMenu onAdd={(kind) => addAfter(notebook.blocks.length - 1, kind)} />
        </div>
      )}
    </div>
  );
}

