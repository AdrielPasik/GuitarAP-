import { useState } from 'react';
import type { NotebookContent } from '@/core/model';
import {
  duplicateBlock,
  insertBlock,
  moveBlock,
  removeBlock,
  updateBlock,
} from '@/core/notebook';
import { Icon } from '@/components/ui/Icon';
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
function summaryOf(block: NotebookContent['blocks'][number]) {
  if (block.kind === 'map') {
    const notes = block.content.baseNotes.length;
    return `${notes} ${notes === 1 ? 'nota' : 'notas'} · ${block.content.positions.length} ${block.content.positions.length === 1 ? 'posición' : 'posiciones'}`;
  }
  if (block.kind === 'tablature') return `${block.content.columns.length} eventos`;
  return block.text.slice(0, 40);
}

export function NotebookBlocks({
  notebook,
  change,
  undo,
  onExportBlock,
  onActiveChange,
  readOnly = false,
}: {
  notebook: NotebookContent;
  change?: Change;
  undo?: () => void;
  onExportBlock?: (blockId: string) => void;
  onActiveChange?: (blockId: string) => void;
  readOnly?: boolean;
}) {
  const toast = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  // Folding is a view state: it is never saved and never changes the document.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const edit: Change = change ?? (() => undefined);
  const activate = (id: string) => {
    setActiveId(id);
    onActiveChange?.(id);
  };

  function addAfter(index: number, kind: NewBlockKind) {
    const block = blockFor(kind);
    edit((current) => insertBlock(current, block, index));
    activate(block.id);
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
          collapsed={collapsed.has(block.id)}
          summary={summaryOf(block)}
          onToggleCollapse={() =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(block.id)) next.delete(block.id);
              else next.add(block.id);
              return next;
            })
          }
          onExport={onExportBlock && block.kind !== 'text' ? () => onExportBlock(block.id) : undefined}
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
              onActivate={() => activate(block.id)}
              onChange={(update) =>
                edit((current) => updateBlock(current, block.id, (item) => (item.kind === 'tablature' ? { ...item, content: update(item.content) } : item)))
              }
            />
          )}
          {block.kind === 'map' && (
            <div onFocusCapture={() => activate(block.id)} onPointerDownCapture={() => activate(block.id)}>
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
          <h2>Empezá tu material</h2>
          <div className="empty-actions">
            <button type="button" className="btn" onClick={() => addAfter(-1, 'map')}>
              <Icon name="map" size={14} /> Agregar mapa
            </button>
            <button type="button" className="btn" onClick={() => addAfter(-1, 'tablature')}>
              <Icon name="tab" size={14} /> Agregar tablatura
            </button>
            <button type="button" className="btn" onClick={() => addAfter(-1, 'note')}>
              <Icon name="text" size={14} /> Agregar nota
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

