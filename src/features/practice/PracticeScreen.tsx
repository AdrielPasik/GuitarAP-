import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { MusicalDocument } from '@/core/model';
import { documentKind, notebookOutline, toNotebook } from '@/core/notebook';
import { usePref } from '@/core/prefs';
import { Icon } from '@/components/ui/Icon';
import { Menu, Popover } from '@/components/ui/Popover';
import { useLibrary } from '@/data/use-library';
import { MetronomeStrip } from '@/features/metronome/MetronomeBar';
import { NotebookBlocks } from '@/features/notebook/NotebookBlocks';

const ZOOM_MIN = 0.8;
const ZOOM_MAX = 2.2;
const kindIcon = { tablature: 'tab', map: 'map', mixed: 'mixed' } as const;

function MaterialPicker({ documents, current, onPick }: { documents: MusicalDocument[]; current?: MusicalDocument; onPick: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const text = query.trim().toLocaleLowerCase();
  const shown = documents.filter((item) => !text || item.title.toLocaleLowerCase().includes(text)).slice(0, 40);
  return (
    <Popover
      label="Elegir material"
      triggerClassName="btn picker"
      trigger={
        <>
          {current ? <Icon name={kindIcon[documentKind(current)]} size={14} /> : null}
          <span className="picker-name">{current?.title || 'Elegí un material'}</span>
          <Icon name="chevron-down" size={12} />
        </>
      }
    >
      {(close) => (
        <div className="picker-panel">
          <input autoFocus type="search" aria-label="Buscar material para practicar" placeholder="Buscar…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <ul>
            {shown.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === current?.id ? 'on' : ''}
                  onClick={() => {
                    onPick(item.id);
                    close();
                  }}
                >
                  <Icon name={kindIcon[documentKind(item)]} size={14} />
                  {item.title || 'Sin título'}
                </button>
              </li>
            ))}
            {!shown.length && <li className="muted small pad">Sin resultados.</li>}
          </ul>
        </div>
      )}
    </Popover>
  );
}

/** Reading view: the music is the interface. Nothing here can change a document. */
export function PracticeScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { documents } = useLibrary();
  const [last, setLast] = usePref<string>('practice-last', '');
  const [zoom, setZoom] = usePref('practice-zoom', 1.15);
  const [focus, setFocus] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const current = documents.find((item) => item.id === (id ?? last)) ?? (id ? undefined : documents[0]);
  const neighbors = useMemo(() => {
    const pool = current?.songId
      ? documents.filter((item) => item.songId === current.songId).sort((a, b) => a.createdAt - b.createdAt)
      : [...documents].sort((a, b) => a.title.localeCompare(b.title, 'es'));
    const index = pool.findIndex((item) => item.id === current?.id);
    return { previous: index > 0 ? pool[index - 1] : undefined, next: index >= 0 ? pool[index + 1] : undefined };
  }, [current, documents]);
  const notebook = useMemo(() => (current ? toNotebook(current) : null), [current]);
  const outline = notebook ? notebookOutline(notebook) : [];

  const go = (target: string) => {
    setLast(target);
    navigate(`/practica/${target}`);
  };

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
          <MaterialPicker documents={documents} current={current} onPick={go} />
          <div className="practice-nav" role="group" aria-label="Navegar entre materiales">
            <button type="button" className="icon-btn" aria-label="Material anterior" title="Material anterior (Alt+←)" disabled={!neighbors.previous} onClick={() => neighbors.previous && go(neighbors.previous.id)}>
              <Icon name="chevron-left" />
            </button>
            <button type="button" className="icon-btn" aria-label="Material siguiente" title="Material siguiente (Alt+→)" disabled={!neighbors.next} onClick={() => neighbors.next && go(neighbors.next.id)}>
              <Icon name="chevron-right" />
            </button>
          </div>
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
          {current && (
            <Link className="btn btn-ghost" to={`/material/${current.id}`}>
              <Icon name="pencil" size={14} /> Editar
            </Link>
          )}
        </header>
      )}
      <div className="practice-stage" style={{ zoom }}>
        {current && notebook ? (
          <>
            <h2 className="practice-title">{current.title || 'Sin título'}</h2>
            <NotebookBlocks notebook={notebook} readOnly />
          </>
        ) : (
          <p className="practice-empty">
            {id ? 'No encontramos ese material.' : 'Todavía no tenés materiales para practicar. '}
            <Link to="/biblioteca">Ir a la biblioteca</Link>
          </p>
        )}
      </div>
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
