import { useState } from 'react';
import type { NotebookContent } from '@/core/model';
import {
  addComment,
  deleteComment,
  duplicateBlock,
  editComment,
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
import { MelodyBlock } from '@/features/melody/MelodyBlock';
import { LyricsBlock } from '@/features/lyrics/LyricsBlock';
import { ChordsBlock } from '@/features/chords/ChordsBlock';
import { CommentsContext, type CommentsApi } from '@/features/notebook/comments-context';
import { NotebookInfoContext } from '@/features/notebook/notebook-context';
import { SongBar } from '@/features/notebook/SongBar';
import { melodyToMidi, downloadMidi } from '@/audio/midi';
import { totalBeats as melodyBeats, noteCount } from '@/features/melody/operations';

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
  if (block.kind === 'melody') return `${noteCount(block.content)} notas · ${melodyBeats(block.content)} pulsos`;
  if (block.kind === 'chords') return block.content.items.map((item) => item.symbol).join(' ').slice(0, 48) || 'Sin acordes';
  if (block.kind === 'lyrics') return block.content.text.trim().split('\n').find((line) => line.trim() && !line.startsWith('#'))?.slice(0, 48) ?? 'Sin letra';
  if (block.kind === 'text') return block.text.slice(0, 40);
  return '';
}

export function NotebookBlocks({
  notebook,
  change,
  undo,
  onExportBlock,
  onActiveChange,
  onOpenTools,
  readOnly = false,
}: {
  notebook: NotebookContent;
  change?: Change;
  undo?: () => void;
  onExportBlock?: (blockId: string) => void;
  onActiveChange?: (blockId: string) => void;
  onOpenTools?: (context?: { chord?: string }) => void;
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

  const comments: CommentsApi = {
    all: notebook.comments ?? [],
    readOnly,
    add: (target, text) => edit((current) => addComment(current, target, text).notebook),
    edit: (id, text) => edit((current) => editComment(current, id, text)),
    remove: (id) => {
      edit((current) => deleteComment(current, id));
      toast.show('Comentario eliminado.', undo ? { label: 'Deshacer', onAction: undo } : undefined);
    },
  };

  return (
    <NotebookInfoContext value={{ docBpm: notebook.meta?.bpm, key: notebook.meta?.key, openTools: readOnly ? undefined : onOpenTools, readOnly }}>
    <CommentsContext value={comments}>
    <div className="blocks">
      <SongBar notebook={notebook} readOnly={readOnly} change={edit} />
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
          {block.kind === 'melody' && (
            <MelodyBlock
              blockId={block.id}
              content={block.content}
              readOnly={readOnly}
              onActivate={() => activate(block.id)}
              onExportMidi={() => downloadMidi(melodyToMidi(block.content, block.content.bpm ?? notebook.meta?.bpm ?? 96), block.title?.trim() || 'melodia')}
              onChange={(update) =>
                edit((current) => updateBlock(current, block.id, (item) => (item.kind === 'melody' ? { ...item, content: update(item.content) } : item)))
              }
            />
          )}
          {block.kind === 'lyrics' && (
            <LyricsBlock
              blockId={block.id}
              content={block.content}
              readOnly={readOnly}
              onChange={(update) =>
                edit((current) => updateBlock(current, block.id, (item) => (item.kind === 'lyrics' ? { ...item, content: update(item.content) } : item)))
              }
            />
          )}
          {block.kind === 'chords' && (
            <ChordsBlock
              blockId={block.id}
              content={block.content}
              readOnly={readOnly}
              onActivate={() => activate(block.id)}
              onChange={(update) =>
                edit((current) => updateBlock(current, block.id, (item) => (item.kind === 'chords' ? { ...item, content: update(item.content) } : item)))
              }
            />
          )}
          {!['tablature', 'map', 'melody', 'lyrics', 'chords', 'text'].includes(block.kind) && (
            <p className="muted unknown-block">
              Este bloque viene de una versión más nueva de GuitarAP y no se puede mostrar acá. Sigue guardado tal como estaba y no se modifica.
            </p>
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
            <button type="button" className="btn" onClick={() => addAfter(-1, 'melody')}>
              <Icon name="melody" size={14} /> Agregar melodía
            </button>
            <button type="button" className="btn" onClick={() => addAfter(-1, 'lyrics')}>
              <Icon name="lyrics" size={14} /> Agregar letra
            </button>
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
    </CommentsContext>
    </NotebookInfoContext>
  );
}

