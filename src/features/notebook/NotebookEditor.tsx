import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { MusicalDocument } from '@/core/model';
import { documentKind } from '@/core/notebook';
import { Icon } from '@/components/ui/Icon';
import { Menu } from '@/components/ui/Popover';
import { useToast } from '@/components/ui/toast-context';
import { libraryRepository } from '@/data/library-repository';
import { AddBlockMenu } from '@/features/notebook/blocks';
import { HistoryDialog, ShortcutsDialog } from '@/features/notebook/dialogs';
import { blockFor } from '@/features/notebook/block-meta';
import { NotebookBlocks } from '@/features/notebook/NotebookBlocks';
import { useNotebookDocument, type SaveState } from '@/features/notebook/useNotebookDocument';
import { insertBlock, newBlock, setMeta, updateBlock } from '@/core/notebook';
import { applyNotes, generatedScaleNotes } from '@/features/fretboard/operations';
import { keyTitle, tonicPc, type KeyRef } from '@/core/theory/keys';
import { useNoteStyle } from '@/features/melody/note-style';
import type { ToolsContext } from '@/features/harmony-tools/HarmonyTools';
import { everything, onlyBlock, type ExportSelection } from '@/features/export/export-plan';

const HarmonyTools = lazy(() => import('@/features/harmony-tools/HarmonyTools').then((module) => ({ default: module.HarmonyTools })));
const ExportDialog = lazy(() => import('@/features/export/ExportDialog').then((module) => ({ default: module.ExportDialog })));

const kindLabel = { tablature: 'Tablatura', map: 'Mapa', mixed: 'Material de estudio', melody: 'Melodía', lyrics: 'Letra', chords: 'Acordes', composition: 'Composición' } as const;

export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'error') {
    return (
      <button type="button" className="save-state error" onClick={onRetry} title="Reintentar guardado">
        <Icon name="alert" size={14} /> No se pudo guardar · Reintentar
      </button>
    );
  }
  return (
    <span className={`save-state ${state}`} role="status">
      <Icon name={state === 'saving' ? 'sync' : 'check'} size={14} className={state === 'saving' ? 'spin' : undefined} />
      {state === 'saving' ? 'Guardando…' : 'Guardado'}
    </span>
  );
}

function isTextField(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.classList.contains('tb-fret')) return false;
  return target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== 'checkbox');
}

export function NotebookEditor({
  document: record,
  location,
  onRestored,
}: {
  document: MusicalDocument;
  location: string;
  onRestored: () => void;
}) {
  const doc = useNotebookDocument(record);
  const navigate = useNavigate();
  const toast = useToast();
  const [dialog, setDialog] = useState<null | 'history' | 'shortcuts'>(null);
  const [exportFor, setExportFor] = useState<ExportSelection | null>(null);
  const [activeBlock, setActiveBlock] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolsContext | null>(null);
  const [style] = useNoteStyle();
  const chordsBlock = [...doc.notebook.blocks].reverse().find((block) => block.kind === 'chords' && block.id === activeBlock) ?? [...doc.notebook.blocks].reverse().find((block) => block.kind === 'chords');
  const addChords = (symbols: string[]) => {
    if (!chordsBlock) return;
    doc.change((current) =>
      updateBlock(current, chordsBlock.id, (block) =>
        block.kind === 'chords' ? { ...block, content: { ...block.content, items: [...block.content.items, ...symbols.map((symbol) => ({ id: crypto.randomUUID(), symbol, beats: 2 }))] } } : block,
      ),
    );
    toast.show(symbols.length === 1 ? `Se agregó ${symbols[0]} a la progresión.` : `Se agregaron ${symbols.length} acordes a la progresión.`);
  };
  const createScaleMap = (key: KeyRef) => {
    const block = newBlock('map');
    if (block.kind !== 'map') return;
    const base = { ...block.content, root: tonicPc(key.tonic), latin: style === 'latin', view: { guide: false } };
    const content = applyNotes(base, base.selectedPositionId, generatedScaleNotes(base, key.mode === 'major' ? 'Mayor' : 'Menor natural'), 'merge');
    doc.change((current) => insertBlock(current, { ...block, title: `${keyTitle(key, style)}`, content }));
    toast.show('Se agregó un mapa de la escala al cuaderno.');
  };
  const kind = documentKind({ ...record, content: doc.notebook });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isTextField(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) doc.redo();
        else doc.undo();
      } else if (key === 'y') {
        event.preventDefault();
        doc.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc]);

  function openExport(blockId: string | null) {
    setExportFor(blockId ? onlyBlock(blockId) : everything(doc.notebook));
  }

  return (
    <section className="notebook" aria-label={`Material: ${doc.title}`}>
      <header className="doc-head">
        <Link className="back-link" to={record.songId ?? record.nodeId ? `/biblioteca?c=${record.songId ?? record.nodeId}` : '/biblioteca'} aria-label={`Volver a la biblioteca${location ? `, ${location}` : ''}`}>
          <Icon name="chevron-left" size={16} />
          <span>{location || 'Biblioteca'}</span>
        </Link>
        <input
          className="doc-title"
          aria-label="Título del material"
          placeholder="Sin título"
          value={doc.title}
          onChange={(event) => doc.setTitle(event.target.value)}
        />
        <span className="doc-kind">{kindLabel[kind]}</span>
        <div className="doc-actions">
          <SaveIndicator state={doc.saveState} onRetry={() => void doc.retry()} />
          <button type="button" className="icon-btn" aria-label="Deshacer" title="Deshacer (Ctrl+Z)" disabled={!doc.canUndo} onClick={doc.undo}>
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-btn" aria-label="Rehacer" title="Rehacer (Ctrl+Y)" disabled={!doc.canRedo} onClick={doc.redo}>
            <Icon name="redo" />
          </button>
          <AddBlockMenu
            align="end"
            onAdd={(kindToAdd) => doc.change((current) => insertBlock(current, blockFor(kindToAdd)))}
          />
          <Link className="btn" to={`/practica/${record.id}`}>
            <Icon name="practice" size={14} /> Practicar
          </Link>
          <button type="button" className="btn" aria-pressed={Boolean(tools)} onClick={() => setTools((current) => (current ? null : { key: doc.notebook.meta?.key, bpm: doc.notebook.meta?.bpm }))}>
            <Icon name="circle" size={14} /> Armonía
          </button>
          <button type="button" className="btn" onClick={() => openExport(null)}>
            <Icon name="export" size={14} /> Exportar
          </button>
          <Menu
            label="Más acciones del material"
            align="end"
            triggerClassName="icon-btn"
            trigger={<Icon name="more" />}
            items={[
              { label: 'Historial de versiones…', icon: 'history', onSelect: () => setDialog('history') },
              { label: 'Atajos de teclado', icon: 'keyboard', onSelect: () => setDialog('shortcuts') },
              { separator: true },
              {
                label: 'Duplicar material',
                icon: 'copy',
                onSelect: () =>
                  void libraryRepository.duplicateDocument(record.id).then((copy) => {
                    toast.show('Se creó una copia.');
                    navigate(`/material/${copy.id}`);
                  }),
              },
              {
                label: 'Enviar a la papelera',
                icon: 'trash',
                danger: true,
                onSelect: () =>
                  void libraryRepository.trashDocument(record.id).then(() => {
                    toast.show('Material enviado a la papelera. Podés restaurarlo desde Configuración.');
                    navigate('/biblioteca');
                  }),
              },
            ]}
          />
        </div>
      </header>

      <div className={`nb-page${tools ? ' with-tools' : ''}`}>
        <NotebookBlocks
          notebook={doc.notebook}
          change={doc.change}
          undo={doc.undo}
          documentId={record.id}
          onExportBlock={openExport}
          onActiveChange={setActiveBlock}
          onOpenTools={(context) => setTools({ key: doc.notebook.meta?.key, bpm: doc.notebook.meta?.bpm, ...context })}
        />
      </div>
      {tools && (
        <Suspense fallback={null}>
          <HarmonyTools
            key={`${tools.chord ?? ''}`}
            context={{ ...tools, key: doc.notebook.meta?.key, bpm: doc.notebook.meta?.bpm }}
            actions={{
              canAddChord: Boolean(chordsBlock),
              onAddChord: (symbol) => addChords([symbol]),
              onAddProgression: addChords,
              onUseKey: (key) => {
                doc.change((current) => setMeta(current, { key }));
                toast.show(`Tonalidad del cuaderno: ${keyTitle(key, style)}. No se transpuso nada.`);
              },
              onCreateMap: createScaleMap,
            }}
            onClose={() => setTools(null)}
          />
        </Suspense>
      )}

      {dialog === 'history' && <HistoryDialog documentId={record.id} onClose={() => setDialog(null)} onRestored={onRestored} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {exportFor && (
        <Suspense fallback={null}>
          <ExportDialog title={doc.title} notebook={doc.notebook} initial={exportFor} activeBlockId={activeBlock} onClose={() => setExportFor(null)} />
        </Suspense>
      )}
    </section>
  );
}
