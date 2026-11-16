import { useEffect, useRef, useState } from 'react';
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
import { insertBlock } from '@/core/notebook';

const kindLabel = { tablature: 'Tablatura', map: 'Mapa', mixed: 'Material de estudio' } as const;

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
  const page = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<null | 'history' | 'shortcuts'>(null);
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

  async function exportAs(format: 'png' | 'pdf') {
    const element = page.current;
    if (!element) return;
    element.classList.add('is-exporting');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      const tools = await import('@/features/export/export-document');
      if (format === 'png') await tools.exportPng(element, doc.title);
      else await tools.exportPdf(element, doc.title);
    } catch {
      toast.show('No se pudo exportar. Probá de nuevo.');
    } finally {
      element.classList.remove('is-exporting');
    }
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
          <Menu
            label="Exportar"
            align="end"
            triggerClassName="btn"
            trigger={
              <>
                <Icon name="export" size={14} /> Exportar
              </>
            }
            items={[
              { label: 'Imagen PNG', onSelect: () => void exportAs('png') },
              { label: 'Documento PDF', onSelect: () => void exportAs('pdf') },
            ]}
          />
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

      <div ref={page} className="nb-page">
        <h1 className="export-title">{doc.title}</h1>
        <NotebookBlocks notebook={doc.notebook} change={doc.change} undo={doc.undo} />
      </div>

      {dialog === 'history' && <HistoryDialog documentId={record.id} onClose={() => setDialog(null)} onRestored={onRestored} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
    </section>
  );
}
