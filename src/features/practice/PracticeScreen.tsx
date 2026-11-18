import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { notebookOutline, toNotebook } from '@/core/notebook';
import { usePref } from '@/core/prefs';
import type { NotebookContent } from '@/core/model';
import { Icon } from '@/components/ui/Icon';
import { Menu } from '@/components/ui/Popover';
import { useLibrary } from '@/data/use-library';
import { MetronomeStrip } from '@/features/metronome/MetronomeBar';
import { NotebookBlocks } from '@/features/notebook/NotebookBlocks';
import { MaterialExplorer } from '@/features/practice/MaterialExplorer';
import { partsOf } from '@/features/practice/practice-tree';
import { collabApi, type SharedDocument } from '@/features/share/collab-api';
import { useGateway } from '@/features/share/use-collab';
import { everything } from '@/features/export/export-plan';

const ExportDialog = lazy(() => import('@/features/export/ExportDialog').then((module) => ({ default: module.ExportDialog })));

const ZOOM_MIN = 0.8;
const ZOOM_MAX = 2.2;
const ROLE: Record<string, string> = { owner: 'Propietario', editor: 'Editor', commenter: 'Comentarista', viewer: 'Lector' };

/** A document somebody shared with this account, fetched read-only for practice. Never copied into the library. */
function useSharedMaterial(id: string | undefined) {
  const gateway = useGateway();
  const [state, setState] = useState<{ id: string; value: SharedDocument | 'error' } | null>(null);
  useEffect(() => {
    if (!id || !gateway?.accessToken) return;
    let live = true;
    collabApi
      .pull(gateway, id)
      .then((value) => live && setState({ id, value }))
      .catch(() => live && setState({ id, value: 'error' }));
    return () => {
      live = false;
    };
  }, [id, gateway]);
  if (!id) return undefined;
  return state?.id === id ? state.value : null; // null = loading
}

/** Reading view: the music is the interface. Nothing here can change a document. */
export function PracticeScreen() {
  const { id, sharedId } = useParams();
  const navigate = useNavigate();
  const { nodes, documents } = useLibrary();
  const [last, setLast] = usePref<string>('practice-last', '');
  const [zoom, setZoom] = usePref('practice-zoom', 1.15);
  const [focus, setFocus] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const shared = useSharedMaterial(sharedId);

  const current = sharedId ? undefined : (documents.find((item) => item.id === (id ?? last)) ?? (id ? undefined : documents[0]));
  const parts = useMemo(() => partsOf(documents, current), [current, documents]);
  const neighbors = useMemo(() => {
    const pool = current?.songId ? parts : [...documents].sort((a, b) => a.title.localeCompare(b.title, 'es'));
    const index = pool.findIndex((item) => item.id === current?.id);
    return { previous: index > 0 ? pool[index - 1] : undefined, next: index >= 0 ? pool[index + 1] : undefined };
  }, [current, documents, parts]);
  const sharedDoc = shared && shared !== 'error' ? shared : undefined;
  const notebook = useMemo(
    () => (current ? toNotebook(current) : sharedDoc ? toNotebook({ id: sharedDoc.id, type: 'tablature', content: sharedDoc.content as NotebookContent }) : null),
    [current, sharedDoc],
  );
  const outline = notebook ? notebookOutline(notebook) : [];
  const title = current?.title ?? sharedDoc?.title ?? '';
  const material = current?.id ?? sharedDoc?.id ?? '';

  const go = (target: string) => {
    setLast(target);
    navigate(`/practica/${target}`);
  };
  const goShared = (target: string) => navigate(`/practica/c/${target}`);

  // Where you were reading is kept per material, so switching to Edit and back does not lose the place.
  useEffect(() => {
    if (!material || !notebook) return undefined;
    const key = `guitarap.practice-scroll.${material}`;
    let saved = 0;
    try {
      saved = Number(window.sessionStorage.getItem(key)) || 0;
    } catch {
      /* storage unavailable */
    }
    if (saved) window.requestAnimationFrame(() => window.scrollTo(0, saved));
    return () => {
      try {
        window.sessionStorage.setItem(key, String(window.scrollY));
      } catch {
        /* storage unavailable */
      }
    };
  }, [material, notebook]);

  useEffect(() => {
    document.documentElement.dataset.focus = focus ? 'true' : 'false';
    return () => {
      document.documentElement.dataset.focus = 'false';
    };
  }, [focus]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'Escape' && focus) setFocus(false);
      else if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey) setFocus((value) => !value);
      else if (event.altKey && event.key === 'ArrowLeft' && neighbors.previous) go(neighbors.previous.id);
      else if (event.altKey && event.key === 'ArrowRight' && neighbors.next) go(neighbors.next.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }
  const changeZoom = (delta: number) => setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number((zoom + delta).toFixed(2)))));

  return (
    <section className={`practice${focus ? ' focus' : ''}`} aria-label="Modo Práctica">
      {!focus && (
        <header className="practice-bar">
          <h1 className="sr-only">Modo Práctica</h1>
          <MaterialExplorer nodes={nodes} documents={documents} current={current} currentShared={sharedDoc ? { id: sharedDoc.id, title: sharedDoc.title } : undefined} onPick={go} onPickShared={goShared} />
          {parts.length > 1 ? (
            <nav className="practice-parts" aria-label="Partes de la canción">
              {parts.map((part) => (
                <button key={part.id} type="button" className={part.id === current?.id ? 'on' : ''} aria-current={part.id === current?.id ? 'true' : undefined} onClick={() => go(part.id)}>
                  {part.title || 'Sin título'}
                </button>
              ))}
            </nav>
          ) : (
            <div className="practice-nav" role="group" aria-label="Navegar entre materiales">
              <button type="button" className="icon-btn" aria-label="Material anterior" title="Material anterior (Alt+←)" disabled={!neighbors.previous} onClick={() => neighbors.previous && go(neighbors.previous.id)}>
                <Icon name="chevron-left" />
              </button>
              <button type="button" className="icon-btn" aria-label="Material siguiente" title="Material siguiente (Alt+→)" disabled={!neighbors.next} onClick={() => neighbors.next && go(neighbors.next.id)}>
                <Icon name="chevron-right" />
              </button>
            </div>
          )}
          {outline.length > 0 && (
            <Menu
              label="Ir a una sección"
              triggerClassName="btn"
              trigger={
                <>
                  Secciones <Icon name="chevron-down" size={12} />
                </>
              }
              items={outline.map((item) => ({
                label: item.label,
                onSelect: () => document.getElementById(`block-${item.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
              }))}
            />
          )}
          <span className="spacer" />
          <div className="zoom-group" role="group" aria-label="Tamaño de lectura">
            <button type="button" className="icon-btn" aria-label="Reducir tamaño" disabled={zoom <= ZOOM_MIN} onClick={() => changeZoom(-0.1)}>
              <Icon name="minus" size={14} />
            </button>
            <output aria-label="Tamaño actual">{Math.round(zoom * 100)}%</output>
            <button type="button" className="icon-btn" aria-label="Aumentar tamaño" disabled={zoom >= ZOOM_MAX} onClick={() => changeZoom(0.1)}>
              <Icon name="plus" size={14} />
            </button>
          </div>
          {document.fullscreenEnabled && (
            <button type="button" className="btn btn-ghost" aria-pressed={fullscreen} onClick={toggleFullscreen}>
              Pantalla completa
            </button>
          )}
          <button type="button" className="btn" onClick={() => setFocus(true)} title="Ocultar todo salvo la música (F)">
            <Icon name="focus" size={14} /> Modo foco
          </button>
          {notebook && (
            <button type="button" className="btn btn-ghost" onClick={() => setExporting(true)}>
              <Icon name="export" size={14} /> Exportar
            </button>
          )}
          {current && (
            <Link className="btn btn-ghost" to={`/material/${current.id}`}>
              <Icon name="pencil" size={14} /> Editar
            </Link>
          )}
          {sharedDoc && (sharedDoc.role === 'editor' || sharedDoc.role === 'commenter') && (
            <Link className="btn btn-ghost" to={`/compartido/${sharedDoc.id}`}>
              <Icon name="users" size={14} /> {sharedDoc.role === 'editor' ? 'Colaborar' : 'Comentar'}
            </Link>
          )}
        </header>
      )}
      <div className="practice-stage" style={{ zoom }}>
        {notebook ? (
          <>
            {sharedDoc && (
              <p className="practice-shared" role="note">
                <Icon name="users" size={13} /> De otra persona · {ROLE[sharedDoc.role] ?? sharedDoc.role} · solo lectura acá
              </p>
            )}
            <h2 className="practice-title">{title || 'Sin título'}</h2>
            <NotebookBlocks notebook={notebook} documentId={material} readOnly />
          </>
        ) : sharedId ? (
          <p className="practice-empty" role={shared === 'error' ? 'alert' : 'status'}>
            {shared === 'error' ? 'No pudimos abrir ese material compartido: puede que ya no tengas acceso.' : 'Abriendo el material compartido…'}{' '}
            <Link to="/compartidos">Ver compartidos conmigo</Link>
          </p>
        ) : (
          <p className="practice-empty">
            {id ? 'No encontramos ese material.' : 'Todavía no tenés materiales para practicar. '}
            <Link to="/biblioteca">Ir a la biblioteca</Link>
          </p>
        )}
      </div>
      {exporting && notebook && (
        <Suspense fallback={null}>
          <ExportDialog title={title} notebook={notebook} initial={everything(notebook)} onClose={() => setExporting(false)} />
        </Suspense>
      )}
      {focus && (
        <div className="practice-foot">
          <MetronomeStrip />
          <button type="button" className="btn btn-ghost" onClick={() => setFocus(false)}>
            Salir del modo foco <kbd>Esc</kbd>
          </button>
        </div>
      )}
    </section>
  );
}
