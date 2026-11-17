import { useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import type { NotebookBlock, NotebookContent } from '@/core/model';
import {
  addComment,
  deleteComment,
  duplicateBlock,
  duplicateSection,
  editComment,
  insertBlock,
  isTextual,
  moveBlock,
  moveBlockTo,
  moveBlockToSection,
  moveSection,
  removeBlock,
  removeSection,
  sectionRange,
  sectionsOf,
  transferText,
  updateBlock,
} from '@/core/notebook';
import { Icon } from '@/components/ui/Icon';
import type { MenuItem } from '@/components/ui/Popover';
import { useToast } from '@/components/ui/toast-context';
import { MapBlock } from '@/features/fretboard/MapBlock';
import { AddBlockMenu, BlockFrame, SectionHeader, TextBlock } from '@/features/notebook/blocks';
import { blockFor, type NewBlockKind } from '@/features/notebook/block-meta';
import { TabBlock } from '@/features/tablature/TabBlock';
import { MelodyBlock } from '@/features/melody/MelodyBlock';
import { LyricsBlock } from '@/features/lyrics/LyricsBlock';
import { ChordsBlock } from '@/features/chords/ChordsBlock';
import { CommentsContext, type CommentsApi } from '@/features/notebook/comments-context';
import { NotebookInfoContext } from '@/features/notebook/notebook-context';
import { SongBar } from '@/features/notebook/SongBar';
import { BlockChoiceDialog, SectionPickerDialog, TextTransferDialog, type TransferMode } from '@/features/notebook/transfer-dialogs';
import { VocalView } from '@/features/notebook/VocalView';
import { useMetronome } from '@/features/metronome/metronome-context';
import { melodyToMidi, downloadMidi } from '@/audio/midi';
import { totalBeats as melodyBeats, noteCount } from '@/features/melody/operations';

type Change = (update: (notebook: NotebookContent) => NotebookContent) => void;

function summaryOf(block: NotebookBlock) {
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

const KNOWN = ['tablature', 'map', 'melody', 'lyrics', 'chords', 'text', 'section'];

/** The text range selected inside the writing field of a block, if any (a selection survives the menu click). */
function selectionIn(blockId: string): { start: number; end: number } | null {
  const area = document.querySelector<HTMLTextAreaElement>(`[id="block-${blockId}"] textarea`);
  if (!area || area.selectionStart === area.selectionEnd) return null;
  return { start: area.selectionStart, end: area.selectionEnd };
}

/**
 * The ordered blocks of a notebook, grouped by optional sections. The same component edits (readOnly = false) and
 * reads in practice and shared views; both render exactly the same music.
 */
export function NotebookBlocks({
  notebook,
  change,
  undo,
  onExportBlock,
  onActiveChange,
  onOpenTools,
  onRequestTransfer,
  documentId,
  onAddComment,
  readOnly = false,
}: {
  notebook: NotebookContent;
  change?: Change;
  undo?: () => void;
  onExportBlock?: (blockId: string) => void;
  onActiveChange?: (blockId: string) => void;
  onOpenTools?: (context?: { chord?: string }) => void;
  /** Move or copy a block to ANOTHER song: the parent owns the (transactional) cross-document write. */
  onRequestTransfer?: (blockId: string, mode: TransferMode) => void;
  /** Lets the metronome follow this song's BPM while it is open. */
  documentId?: string;
  /** A commenter reads the song but may leave comments: the blocks stay read-only. */
  onAddComment?: (target: { blockId?: string; eventId?: string }, text: string) => void;
  readOnly?: boolean;
}) {
  const toast = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  // Folding is a view state: it is never saved and never changes the document.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; edge: 'before' | 'after' } | null>(null);
  const [sectionPicker, setSectionPicker] = useState<string | null>(null);
  const [textMove, setTextMove] = useState<{ blockId: string; mode: TransferMode; start: number; end: number } | null>(null);
  const [linkPicker, setLinkPicker] = useState<string | null>(null);
  const [vocalOpen, setVocalOpen] = useState<string | null>(null);
  const edit: Change = change ?? (() => undefined);
  const metro = useMetronome();
  const setSongContext = metro.setSongContext;
  const songBpm = notebook.meta?.bpm;
  useEffect(() => {
    if (documentId) setSongContext(documentId, songBpm);
  }, [documentId, songBpm, setSongContext]);
  useEffect(() => () => setSongContext(null), [setSongContext]);
  const activate = (id: string) => {
    setActiveId(id);
    onActiveChange?.(id);
  };
  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function addAfter(index: number, kind: NewBlockKind) {
    const block = blockFor(kind);
    edit((current) => insertBlock(current, block, index));
    activate(block.id);
    requestAnimationFrame(() => document.getElementById(`block-${block.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }
  function addInsideSection(sectionId: string, kind: NewBlockKind) {
    const range = sectionRange(notebook, sectionId);
    if (range) addAfter(range[1] - 1, kind);
  }

  // Blocks hidden by a folded section, and the blocks shown together in the "Letra + melodía" view.
  const lyricsIds = new Set(notebook.blocks.filter((block) => block.kind === 'lyrics').map((block) => block.id));
  const linkOf = (block: NotebookBlock) => (block.kind === 'melody' && block.content.lyricsBlockId && lyricsIds.has(block.content.lyricsBlockId) ? block.content.lyricsBlockId : null);
  const pairs = useMemo(() => {
    const list: Array<{ melodyId: string; lyricsId: string }> = [];
    for (const block of notebook.blocks) {
      if (block.kind !== 'melody' || !block.content.lyricsBlockId || !lyricsIds.has(block.content.lyricsBlockId)) continue;
      // Reading shows every linked pair together; editing shows the one that was opened.
      if (readOnly || vocalOpen === block.id) list.push({ melodyId: block.id, lyricsId: block.content.lyricsBlockId });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebook.blocks, readOnly, vocalOpen]);
  const hidden = new Set<string>();
  const folded = [...collapsed];
  for (const sectionId of folded) {
    const range = sectionRange(notebook, sectionId);
    if (range) notebook.blocks.slice(range[0] + 1, range[1]).forEach((block) => hidden.add(block.id));
  }
  const inPair = new Set(pairs.flatMap((pair) => [pair.melodyId, pair.lyricsId]));
  const pairAnchor = new Map<string, { melodyId: string; lyricsId: string }>();
  for (const pair of pairs) {
    const first = notebook.blocks.find((block) => block.id === pair.melodyId || block.id === pair.lyricsId)!;
    pairAnchor.set(first.id, pair);
  }

  const comments: CommentsApi = {
    all: notebook.comments ?? [],
    readOnly: readOnly && !onAddComment,
    addOnly: Boolean(onAddComment),
    add: onAddComment ?? ((target, text) => edit((current) => addComment(current, target, text).notebook)),
    edit: (id, text) => edit((current) => editComment(current, id, text)),
    remove: (id) => {
      edit((current) => deleteComment(current, id));
      toast.show('Comentario eliminado.', undo ? { label: 'Deshacer', onAction: undo } : undefined);
    },
  };

  function renderBody(block: NotebookBlock, index: number) {
    void index;
    return (
      <>
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
        {!KNOWN.includes(block.kind) && (
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
      </>
    );
  }

  function startTextMove(block: NotebookBlock, mode: TransferMode) {
    const selection = selectionIn(block.id);
    if (!selection) {
      toast.show('Primero seleccioná, dentro del bloque, el texto que querés pasar.');
      return;
    }
    setTextMove({ blockId: block.id, mode, ...selection });
  }

  function linkMelody(melodyId: string, lyricsId: string | undefined) {
    edit((current) =>
      updateBlock(current, melodyId, (item) => {
        if (item.kind !== 'melody') return item;
        const content = { ...item.content };
        if (lyricsId) content.lyricsBlockId = lyricsId;
        else delete content.lyricsBlockId;
        return { ...item, content };
      }),
    );
  }

  const sections = sectionsOf(notebook);
  function menuFor(block: NotebookBlock): MenuItem[] {
    if (readOnly) return [];
    const items: MenuItem[] = [];
    if (block.kind === 'melody') {
      const linked = linkOf(block);
      items.push(
        linked
          ? { label: 'Ver con su letra (Letra + melodía)', icon: 'lyrics', onSelect: () => setVocalOpen(block.id) }
          : { label: 'Vincular con una letra…', icon: 'link2', onSelect: () => setLinkPicker(block.id) },
      );
      if (linked) items.push({ label: 'Quitar el vínculo con la letra', description: 'Ambos bloques siguen existiendo', icon: 'close', onSelect: () => linkMelody(block.id, undefined) });
    }
    if (block.kind === 'lyrics') {
      const melody = notebook.blocks.find((item) => item.kind === 'melody' && item.content.lyricsBlockId === block.id);
      if (melody) items.push({ label: 'Ver con su melodía (Letra + melodía)', icon: 'melody', onSelect: () => setVocalOpen(melody.id) });
    }
    if (sections.length > 0 && block.kind !== 'section') items.push({ label: 'Mover a otra sección…', icon: 'arrow-down', onSelect: () => setSectionPicker(block.id) });
    if (onRequestTransfer) {
      items.push({ label: 'Mover a otra canción…', icon: 'export', onSelect: () => onRequestTransfer(block.id, 'move') });
      items.push({ label: 'Copiar a otra canción…', icon: 'copy', onSelect: () => onRequestTransfer(block.id, 'copy') });
    }
    if (isTextual(block)) {
      items.push({ label: 'Mover el texto seleccionado a…', description: 'A otro bloque de esta canción', icon: 'text', onSelect: () => startTextMove(block, 'move') });
      items.push({ label: 'Copiar el texto seleccionado a…', icon: 'copy', onSelect: () => startTextMove(block, 'copy') });
    }
    return items;
  }

  const dragProps = (block: NotebookBlock) =>
    readOnly
      ? undefined
      : {
          dragging: dragId === block.id,
          edge: dropAt?.id === block.id ? dropAt.edge : null,
          onDragStart: (event: DragEvent) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', block.id);
            setDragId(block.id);
          },
          onDragEnd: () => {
            setDragId(null);
            setDropAt(null);
          },
          onDragOver: (event: DragEvent) => {
            if (!dragId || dragId === block.id) return;
            event.preventDefault();
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            const edge = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
            setDropAt((current) => (current?.id === block.id && current.edge === edge ? current : { id: block.id, edge }));
          },
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            if (!dragId || dragId === block.id) return;
            const to = notebook.blocks.findIndex((item) => item.id === block.id) + (dropAt?.edge === 'after' ? 1 : 0);
            const from = notebook.blocks.findIndex((item) => item.id === dragId);
            const moving = dragId;
            edit((current) => moveBlockTo(current, moving, to > from ? to - 1 : to));
            setDragId(null);
            setDropAt(null);
          },
        };

  const movingBlock = sectionPicker ? notebook.blocks.find((block) => block.id === sectionPicker) : null;
  const textSource = textMove ? notebook.blocks.find((block) => block.id === textMove.blockId) : null;
  const linkSource = linkPicker ? notebook.blocks.find((block) => block.id === linkPicker) : null;

  return (
    <NotebookInfoContext value={{ docBpm: notebook.meta?.bpm, key: notebook.meta?.key, openTools: readOnly ? undefined : onOpenTools, readOnly }}>
      <CommentsContext value={comments}>
        <div className="blocks">
          <SongBar notebook={notebook} readOnly={readOnly} change={edit} />
          {notebook.blocks.map((block, index) => {
            const pair = pairAnchor.get(block.id);
            const vocal = pair ? (
              <VocalView
                key={`vocal-${pair.melodyId}`}
                lyrics={notebook.blocks.find((item) => item.id === pair.lyricsId)!}
                melody={notebook.blocks.find((item) => item.id === pair.melodyId)!}
                readOnly={readOnly}
                renderBody={renderBody}
                onClose={() => setVocalOpen(null)}
                index={index}
              />
            ) : null;
            if (hidden.has(block.id) || inPair.has(block.id)) return vocal;
            if (block.kind === 'section') {
              const range = sectionRange(notebook, block.id)!;
              return (
                <SectionHeader
                  key={block.id}
                  block={block}
                  index={index}
                  count={notebook.blocks.length}
                  sectionCount={sections.length}
                  readOnly={readOnly}
                  collapsed={collapsed.has(block.id)}
                  blocksInside={range[1] - range[0] - 1}
                  onTitle={(title) => edit((current) => updateBlock(current, block.id, (item) => (item.kind === 'section' ? { ...item, title } : item)))}
                  onToggle={() => toggleCollapsed(block.id)}
                  onMoveSection={(offset) => edit((current) => moveSection(current, block.id, offset))}
                  onDuplicate={() => edit((current) => duplicateSection(current, block.id))}
                  onRemove={(withContent) => {
                    edit((current) => removeSection(current, block.id, withContent));
                    toast.show(withContent ? 'Sección eliminada con su contenido.' : 'Encabezado eliminado: los bloques siguen en el cuaderno.', undo ? { label: 'Deshacer', onAction: undo } : undefined);
                  }}
                  onAddInside={(kind) => addInsideSection(block.id, kind)}
                />
              );
            }
            const drag = dragProps(block);
            const linked = linkOf(block);
            const linkedLyrics = linked ? notebook.blocks.find((item) => item.id === linked) : null;
            const hasMelody = block.kind === 'lyrics' && notebook.blocks.some((item) => item.kind === 'melody' && item.content.lyricsBlockId === block.id);
            return (
              <div key={block.id} className="block-slot">
                {vocal}
                <BlockFrame
                  block={block}
                  index={index}
                  count={notebook.blocks.length}
                  active={activeId === block.id}
                  readOnly={readOnly}
                  collapsed={collapsed.has(block.id)}
                  summary={summaryOf(block)}
                  badge={linkedLyrics ? 'con su letra' : hasMelody ? 'con su melodía' : undefined}
                  onToggleCollapse={() => toggleCollapsed(block.id)}
                  onExport={onExportBlock && block.kind !== 'text' ? () => onExportBlock(block.id) : undefined}
                  onTitle={(title) => edit((current) => updateBlock(current, block.id, (item) => (item.kind === 'text' || item.kind === 'section' ? item : { ...item, title })))}
                  onMove={(offset) => edit((current) => moveBlock(current, block.id, offset))}
                  onDuplicate={() => edit((current) => duplicateBlock(current, block.id))}
                  onRemove={() => {
                    edit((current) => removeBlock(current, block.id));
                    toast.show('Bloque eliminado.', undo ? { label: 'Deshacer', onAction: undo } : undefined);
                  }}
                  onAddAfter={(kind) => addAfter(index, kind)}
                  extraMenu={menuFor(block)}
                  drag={drag}
                >
                  {renderBody(block, index)}
                </BlockFrame>
              </div>
            );
          })}
          {!readOnly && notebook.blocks.length === 0 && (
            <div className="empty-notebook scenic">
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
                <button type="button" className="btn" onClick={() => addAfter(-1, 'section')}>
                  <Icon name="index" size={14} /> Agregar sección
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
          {movingBlock && (
            <SectionPickerDialog
              notebook={notebook}
              label={movingBlock.kind === 'section' ? movingBlock.title : (('title' in movingBlock && movingBlock.title) || summaryOf(movingBlock) || movingBlock.kind)}
              onClose={() => setSectionPicker(null)}
              onPick={(sectionId) => {
                const id = movingBlock.id;
                edit((current) => moveBlockToSection(current, id, sectionId));
                setSectionPicker(null);
                toast.show('Bloque movido de sección.', undo ? { label: 'Deshacer', onAction: undo } : undefined);
              }}
            />
          )}
          {textMove && textSource && (
            <TextTransferDialog
              mode={textMove.mode}
              notebook={notebook}
              fromBlockId={textMove.blockId}
              preview={(textSource.kind === 'text' ? textSource.text : textSource.kind === 'lyrics' ? textSource.content.text : '').slice(textMove.start, textMove.end)}
              onClose={() => setTextMove(null)}
              onPick={(target) => {
                const request = textMove;
                setTextMove(null);
                edit((current) => {
                  if ('blockId' in target) return transferText(current, { blockId: request.blockId, start: request.start, end: request.end }, target.blockId, request.mode);
                  const created = blockFor(target.create);
                  const at = current.blocks.findIndex((item) => item.id === request.blockId);
                  return transferText(insertBlock(current, created, at), { blockId: request.blockId, start: request.start, end: request.end }, created.id, request.mode);
                });
                toast.show(request.mode === 'move' ? 'Texto movido.' : 'Texto copiado.', undo && request.mode === 'move' ? { label: 'Deshacer', onAction: undo } : undefined);
              }}
            />
          )}
          {linkSource && linkSource.kind === 'melody' && (
            <BlockChoiceDialog
              title="Vincular la melodía con una letra"
              hint="El vínculo es una referencia: no se copia nada y podés quitarlo cuando quieras. Ambos bloques siguen siendo independientes."
              options={notebook.blocks
                .filter((block) => block.kind === 'lyrics')
                .map((block) => ({ id: block.id, label: summaryOf(block) || 'Letra vacía', hint: ('title' in block && block.title) || 'Letra' }))}
              createLabel="Crear una letra vinculada"
              onClose={() => setLinkPicker(null)}
              onPick={(id) => {
                linkMelody(linkSource.id, id);
                setLinkPicker(null);
                setVocalOpen(linkSource.id);
              }}
              onCreate={() => {
                const lyrics = blockFor('lyrics');
                const at = notebook.blocks.findIndex((item) => item.id === linkSource.id);
                edit((current) => {
                  const inserted = insertBlock(current, lyrics, at - 1);
                  return updateBlock(inserted, linkSource.id, (item) => (item.kind === 'melody' ? { ...item, content: { ...item.content, lyricsBlockId: lyrics.id } } : item));
                });
                setLinkPicker(null);
                setVocalOpen(linkSource.id);
              }}
            />
          )}
        </div>
      </CommentsContext>
    </NotebookInfoContext>
  );
}
