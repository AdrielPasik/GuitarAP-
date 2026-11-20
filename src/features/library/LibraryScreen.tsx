import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { LibraryNode, MusicalDocument } from '@/core/model';
import { documentKind, toNotebook, type DocumentKind } from '@/core/notebook';
import { usePref } from '@/core/prefs';
import { Dialog } from '@/components/ui/Dialog';
import { StudioScene } from '@/components/art/Art';
import { NewSongDialog } from '@/features/library/NewSongDialog';
import { collabApi } from '@/features/share/collab-api';
import { useCollabState, useGateway } from '@/features/share/use-collab';
import { lazy, Suspense } from 'react';

import type { ShareProject } from '@/features/share/ShareDialog';
const ShareDialog = lazy(() => import('@/features/share/ShareDialog').then((module) => ({ default: module.ShareDialog })));
import { Icon, type IconName } from '@/components/ui/Icon';
import { Menu } from '@/components/ui/Popover';
import { useToast } from '@/components/ui/toast-context';
import { libraryRepository, type MaterialTemplate } from '@/data/library-repository';
import { ancestry, pathOf } from '@/data/paths';
import { useLibrary } from '@/data/use-library';
import { useAccount } from '@/features/account/account-context';
import {
  applyToDescendants, clonePresentation, DEFAULT_PRESENTATION, resolvePresentation, ROOT_KEY, SORT_NAMES, type Presentation, type PresentationMap,
  type SortKey,
} from '@/core/presentation';
import { CustomizePanel, type DraftMode } from '@/features/library/CustomizePanel';
import { FolderView } from '@/features/library/FolderView';
import { availability, docEntry, nodeEntry, type Entry } from '@/features/library/folder-entries';
import { canEditMeta, MetaDialog } from '@/features/library/MetaDialog';

type Naming = { mode: 'folder' | 'song' | 'rename-node' | 'rename-doc'; id?: string; initial?: string } | null;

const kindInfo: Record<DocumentKind | 'folder' | 'song', { icon: IconName; label: string }> = {
  tablature: { icon: 'tab', label: 'Tablatura' },
  map: { icon: 'map', label: 'Mapa de escala' },
  mixed: { icon: 'mixed', label: 'Material de estudio' },
  melody: { icon: 'melody', label: 'Melodía' },
  lyrics: { icon: 'lyrics', label: 'Letra' },
  chords: { icon: 'chords', label: 'Acordes' },
  composition: { icon: 'song', label: 'Composición' },
  folder: { icon: 'folder', label: 'Carpeta' },
  song: { icon: 'song', label: 'Canción' },
};

function Glyph({ kind }: { kind: keyof typeof kindInfo }) {
  return (
    <span className={`glyph kind-${kind}`} aria-hidden="true">
      <Icon name={kindInfo[kind].icon} size={16} />
    </span>
  );
}

/** A stable hue (0-359) from a name, so each folder and song keeps its own colour like a record sleeve. */
const hueOf = (name: string) => [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);

const when = (time: number) => {
  const days = Math.floor((Date.now() - time) / 86_400_000);
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  return new Date(time).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
};

export function LibraryScreen() {
  const { nodes, documents } = useLibrary();
  const account = useAccount();
  const navigate = useNavigate();
  const toast = useToast();
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [params, setParams] = useSearchParams();
  const folderId = params.get('c');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [naming, setNaming] = useState<Naming>(null);
  const [newSong, setNewSong] = useState(false);
  const [sharing, setSharing] = useState<{ kind: 'document' | 'node'; id: string; title: string; project?: ShareProject; nodeKind?: 'song' | 'folder' } | null>(null);
  const gateway = useGateway();
  const collab = useCollabState();
  const [shared, setShared] = useState<Map<string, { links: number; members: number; invites: number }>>(new Map());
  const signedIn = Boolean(gateway?.accessToken);
  useEffect(() => {
    if (collab !== 'ready' || !signedIn || !gateway) return;
    let live = true;
    collabApi.sharedByMe(gateway).then((list) => live && setShared(new Map(list.map((item) => [item.id, item])))).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [collab, signedIn, gateway, sharing]);
  const [moving, setMoving] = useState<{ kind: 'doc' | 'node'; id: string; title: string; from: string | null } | null>(null);
  const [sort] = usePref<'recent' | 'name'>('library-sort', 'recent');
  // Level B personalisation: how each folder shows itself. Per person and per device, never inside a document.
  const [presentations, setPresentations] = usePref<PresentationMap>('folder-presentations', {});
  const [featuredMap, setFeaturedMap] = usePref<Record<string, string[]>>('folder-featured', {});
  const [customizing, setCustomizing] = useState<{ mode: DraftMode; draft: Presentation } | null>(null);
  const [metaFor, setMetaFor] = useState<MusicalDocument | null>(null);
  const [bannerHidden, setBannerHidden] = usePref('local-banner-hidden', false);
  const current = nodes.find((node) => node.id === folderId) ?? null;
  const trail = useMemo(() => ancestry(nodes, folderId), [nodes, folderId]);
  const recent = useMemo(() => [...documents].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4), [documents]);
  const ideas = useMemo(
    () => documents.filter((item) => (toNotebook(item).meta?.status ?? '') === 'idea').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3),
    [documents],
  );
  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  const open_ = useMemo(() => new Set([...expanded, ...trail.map((node) => node.id)]), [expanded, trail]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const text = query.trim().toLocaleLowerCase();
  const items = useMemo(() => {
    const scoped = text
      ? documents.filter(
          (item) =>
            item.title.toLocaleLowerCase().includes(text) ||
            pathOf(nodes, item.songId ?? item.nodeId).toLocaleLowerCase().includes(text),
        )
      : current?.kind === 'song'
        ? documents.filter((item) => item.songId === current.id)
        : documents.filter((item) => (item.songId ? false : (item.nodeId ?? null) === folderId));
    return [...scoped].sort((a, b) =>
      sort === 'name' ? a.title.localeCompare(b.title, 'es') : b.updatedAt - a.updatedAt,
    );
  }, [current, documents, folderId, nodes, sort, text]);
  const children = text ? [] : nodes.filter((node) => node.parentId === folderId);
  const countIn = (node: LibraryNode) =>
    documents.filter((item) => item.nodeId === node.id || item.songId === node.id).length;
  const everything = documents.length + nodes.length;
  const parentOf = (id: string) => nodes.find((node) => node.id === id)?.parentId;
  const folderKey = folderId ?? ROOT_KEY;
  const resolved = useMemo(() => resolvePresentation(presentations, folderId, (id) => nodes.find((node) => node.id === id)?.parentId), [presentations, folderId, nodes]);
  const storedEntry = presentations[folderKey];
  const currentMode: DraftMode = storedEntry?.mode ?? (folderId && parentOf(folderId) ? 'inherit' : 'default');
  const parentNode = current?.parentId ? nodes.find((node) => node.id === current.parentId) ?? null : null;
  /** While the editor is open its draft IS the folder: the preview is the real view. */
  const presentation: Presentation = customizing
    ? customizing.mode === 'own'
      ? customizing.draft
      : customizing.mode === 'inherit'
        ? resolvePresentation({ ...presentations, [folderKey]: { mode: 'inherit' } }, folderId, parentOf).presentation
        : DEFAULT_PRESENTATION
    : resolved.presentation;
  const entries = useMemo<Entry[]>(() => {
    if (text) return [];
    return [
      ...children.map((node) => nodeEntry(node, countIn(node), shared.has(node.id))),
      ...items.map((item, index) => docEntry(item, shared.has(item.id), index)),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, children.length, nodes, items, shared, documents]);
  const featuredIds = featuredMap[folderKey] ?? [];
  const toggleFeatured = (entry: Entry) => {
    const list = featuredMap[folderKey] ?? [];
    setFeaturedMap({ ...featuredMap, [folderKey]: list.includes(entry.id) ? list.filter((id) => id !== entry.id) : [...list, entry.id].slice(-24) });
  };
  const startCustomizing = () => setCustomizing({ mode: currentMode, draft: clonePresentation(resolved.presentation) });
  const saveCustomizing = () => {
    if (!customizing) return;
    const next = { ...presentations };
    if (customizing.mode === 'own') next[folderKey] = { mode: 'own', presentation: clonePresentation(customizing.draft) };
    else if (customizing.mode === 'default') next[folderKey] = { mode: 'default' };
    else delete next[folderKey];
    setPresentations(next);
    setCustomizing(null);
    toast.show('Se guardó la presentación de la carpeta.');
  };
  /** «Ordenar» is a quick edit of this folder's presentation: explicit, and only this folder. */
  const setFolderSort = (value: SortKey) => {
    setPresentations({ ...presentations, [folderKey]: { mode: 'own', presentation: { ...clonePresentation(resolved.presentation), sort: value } } });
  };
  const available = availability(entries);
  /** The song or folder a part belongs to: the container that «share my song» means. */
  const partOf = (item: { songId?: string | null; nodeId?: string | null }): ShareProject | undefined => {
    const container = nodes.find((node) => node.id === (item.songId ?? item.nodeId) && !node.deletedAt);
    return container ? { id: container.id, title: container.name, kind: container.kind === 'song' ? 'song' : 'folder' } : undefined;
  };

  /** New material lands where you are: in the open folder, or as a part of the open song. */
  async function createFrom(template: MaterialTemplate) {
    const song = current?.kind === 'song' ? current : null;
    const created = await libraryRepository.createFromTemplate(template, song ? song.parentId : folderId, song?.id ?? null);
    navigate(`/material/${created.id}`);
  }
  const open = (item: MusicalDocument) => navigate(`/material/${item.id}`);
  const toggle = (id: string) =>
    setExpanded((value) => {
      const next = new Set(value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  function goTo(id: string | null) {
    setParams(id ? { c: id } : {});
    setQuery('');
  }

  const nodeMenu = (node: LibraryNode) => (
                <Menu
                  label={`Opciones de ${node.name}`}
                  align="end"
                  triggerClassName="icon-btn row-menu"
                  trigger={<Icon name="more" />}
                  items={[
                    { label: 'Abrir', icon: 'folder', onSelect: () => goTo(node.id) },
                    { label: 'Renombrar', icon: 'pencil', onSelect: () => setNaming({ mode: 'rename-node', id: node.id, initial: node.name }) },
                    { label: 'Duplicar', icon: 'copy', onSelect: () => void libraryRepository.duplicateNode(node.id) },
                    { label: 'Personalizar…', icon: 'palette', onSelect: () => goTo(node.id) },
                    { label: 'Mover a…', onSelect: () => setMoving({ kind: 'node', id: node.id, title: node.name, from: node.parentId }) },
                    { label: node.kind === 'song' ? 'Compartir proyecto…' : 'Compartir carpeta…', icon: 'share', onSelect: () => setSharing({ kind: 'node', id: node.id, title: node.name, nodeKind: node.kind === 'song' ? 'song' : 'folder' }) },
                    {
                      label: 'Enviar a la papelera',
                      icon: 'trash',
                      danger: true,
                      onSelect: () => void libraryRepository.trashNode(node.id).then(() => toast.show(`«${node.name}» está en la papelera.`, { label: 'Deshacer', onAction: () => void libraryRepository.restoreNode(node.id) })),
                    },
                  ]}
                />
  );
  const docMenu = (item: MusicalDocument) => (
                  <Menu
                    label={`Opciones de ${item.title || 'material sin título'}`}
                    align="end"
                    triggerClassName="icon-btn row-menu"
                    trigger={<Icon name="more" />}
                    items={[
                      { label: 'Abrir', icon: 'pencil', onSelect: () => open(item) },
                      { label: 'Practicar', icon: 'practice', onSelect: () => navigate(`/practica/${item.id}`) },
                      { label: 'Renombrar', onSelect: () => setNaming({ mode: 'rename-doc', id: item.id, initial: item.title }) },
                      ...(canEditMeta(item) ? [{ label: 'Ficha (artista, portada…)', icon: 'pencil' as const, onSelect: () => setMetaFor(item) }] : []),
                      { label: 'Compartir…', icon: 'share', onSelect: () => setSharing({ kind: 'document', id: item.id, title: item.title, project: partOf(item) }) },
                      { label: 'Duplicar', icon: 'copy', onSelect: () => void libraryRepository.duplicateDocument(item.id) },
                      { label: 'Mover a…', onSelect: () => setMoving({ kind: 'doc', id: item.id, title: item.title, from: item.nodeId }) },
                      {
                        label: 'Enviar a la papelera',
                        icon: 'trash',
                        danger: true,
                        onSelect: () => void libraryRepository.trashDocument(item.id).then(() => toast.show(`«${item.title || 'Material'}» está en la papelera.`, { label: 'Deshacer', onAction: () => void libraryRepository.restoreDocument(item.id) })),
                      },
                    ]}
                  />
  );

  const createMenu = (
    <Menu
      label="Nuevo"
      align="end"
      triggerClassName="btn btn-primary"
      trigger={
        <>
          <Icon name="plus" size={14} /> Nuevo
        </>
      }
      items={[
        { label: 'Nueva canción…', icon: 'song', description: 'Nombre, BPM y tonalidad, y empezás', onSelect: () => setNewSong(true) },
        { separator: true },
        { label: 'Canción con letra', icon: 'lyrics', description: 'Empezá por lo que querés decir', onSelect: () => void createFrom('song-lyrics') },
        { label: 'Canción con melodía', icon: 'melody', description: 'Empezá por lo que escuchás', onSelect: () => void createFrom('song-melody') },
        { label: 'Melodía', icon: 'melody', description: 'Escribí notas y escuchalas', onSelect: () => void createFrom('melody') },
        { label: 'Progresión de acordes', icon: 'chords', description: 'C G Am F, con su tonalidad', onSelect: () => void createFrom('chords') },
        { separator: true },
        { label: 'Mapa de escala', icon: 'map', description: 'Marcá notas, intervalos y posiciones', onSelect: () => void createFrom('scale') },
        { label: 'Acorde o tríada', icon: 'map', description: 'Un mapa con la tríada resaltada', onSelect: () => void createFrom('triad') },
        { label: 'Riff o tablatura', icon: 'tab', description: 'Escribí notas en orden', onSelect: () => void createFrom('riff') },
        { label: 'Cuaderno vacío', icon: 'mixed', description: 'Agregá solo los bloques que quieras', onSelect: () => void createFrom('empty') },
        { label: 'Cuaderno de composición', icon: 'song', description: 'Letra, melodía, solos y comentarios juntos', onSelect: () => void createFrom('composition') },
        { label: 'Escala y frase', icon: 'mixed', description: 'Un mapa y una tablatura juntos', onSelect: () => void createFrom('study') },
        { separator: true },
        { label: 'Canción', icon: 'song', onSelect: () => setNaming({ mode: 'song' }) },
        { label: 'Carpeta', icon: 'folder', onSelect: () => setNaming({ mode: 'folder' }) },
      ]}
    />
  );

  return (
    <div className="library">
      <aside className="lib-tree" aria-label="Carpetas">
        <button type="button" className={`tree-row root${folderId === null ? ' selected' : ''}`} aria-current={folderId === null} onClick={() => goTo(null)}>
          <Icon name="home" size={15} /> Toda la biblioteca
        </button>
        <Tree
          nodes={nodes}
          parentId={null}
          depth={0}
          selectedId={folderId}
          expanded={open_}
          onToggle={toggle}
          onSelect={goTo}
          onMenu={(node) => setNaming({ mode: 'rename-node', id: node.id, initial: node.name })}
        />
        {collab === 'ready' && signedIn && (
          <Link className="tree-row" to="/compartidos">
            <Icon name="users" size={15} /> Compartidos conmigo
          </Link>
        )}
        <Link className="tree-row trash-link" to="/configuracion/recuperacion">
          <Icon name="trash" size={15} /> Papelera
        </Link>
      </aside>

      <section className="lib-main">
        <div className="lib-head">
          <nav className="crumbs" aria-label="Ubicación">
            <h1>
              <button type="button" onClick={() => goTo(null)} aria-current={folderId === null ? 'page' : undefined}>
                Biblioteca
              </button>
            </h1>
            {trail.map((node, index) => (
              <span key={node.id}>
                <Icon name="chevron-right" size={12} />
                <button type="button" onClick={() => goTo(node.id)} aria-current={index === trail.length - 1 ? 'page' : undefined}>
                  {node.name}
                </button>
              </span>
            ))}
          </nav>
          <label className="search">
            <Icon name="search" size={15} />
            <input
              ref={search}
              type="search"
              aria-label="Buscar en la biblioteca"
              placeholder="Buscar materiales  ( / )"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <Menu
            label="Ordenar"
            align="end"
            triggerClassName="btn btn-ghost"
            trigger={
              <>
                {SORT_NAMES[presentation.sort]} <Icon name="chevron-down" size={12} />
              </>
            }
            items={(['updated', 'name', 'created', 'manual', 'kind', 'artist', 'key'] as SortKey[])
              .filter((key) => (key === 'artist' ? available.artist : key === 'key' ? available.key : true))
              .map((key) => ({ label: SORT_NAMES[key], checked: presentation.sort === key, onSelect: () => setFolderSort(key) }))}
          />
          {!text && (
            <button type="button" className="btn btn-ghost" aria-label="Personalizar carpeta" title="Personalizar cómo se ve esta carpeta" aria-pressed={Boolean(customizing)} onClick={() => (customizing ? setCustomizing(null) : startCustomizing())}>
              <Icon name="palette" size={14} /> <span className="hide-narrow">Personalizar</span>
            </button>
          )}
          {current && current.kind !== 'song' && (
            <button type="button" className="btn" onClick={() => setSharing({ kind: 'node', id: current.id, title: current.name, nodeKind: 'folder' })}>
              <Icon name="share" size={14} /> Compartir carpeta
            </button>
          )}
          {createMenu}
        </div>

        {folderId === null && !text && (
          <section className="lib-hero" aria-label="Tu estudio">
            <StudioScene />
            <p className="hero-kicker">{greeting}</p>
            <h2 className="hero-title">
              ¿Qué vas a <em>componer</em> hoy?
            </h2>
            <p className="hero-sub">Escribí una melodía, guardá una letra o estudiá una escala. Todo lo que hagas queda en tu biblioteca.</p>
            <div className="hero-actions">
              <button type="button" className="btn btn-primary" onClick={() => setNewSong(true)}>
                <Icon name="song" size={14} /> Nueva canción
              </button>
              <button type="button" className="btn" onClick={() => void createFrom('melody')}>
                <Icon name="melody" size={14} /> Nueva melodía
              </button>
              <button type="button" className="btn" onClick={() => void createFrom('scale')}>
                <Icon name="map" size={14} /> Nueva escala
              </button>
            </div>
            {recent.length > 0 && (
              <div className="hero-recent">
                <h3>Seguir con</h3>
                {recent.map((item, index) => (
                  <Link key={item.id} className={`recent-chip${index === 0 ? ' continue' : ''}`} to={`/material/${item.id}`} title={item.title || 'Sin título'}>
                    <Icon name={kindInfo[documentKind(item)].icon} size={13} />
                    {index === 0 ? `Continuar: ${item.title || 'Sin título'}` : item.title || 'Sin título'}
                  </Link>
                ))}
              </div>
            )}
            {ideas.length > 0 && (
              <div className="hero-recent">
                <h3>Ideas pendientes</h3>
                {ideas.map((item) => (
                  <Link key={item.id} className="recent-chip" to={`/material/${item.id}`}>
                    <Icon name={kindInfo[documentKind(item)].icon} size={13} />
                    {item.title || 'Sin título'}
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {account.identityMode === 'signed-out' && (
          <p className="local-note signed-out-note" role="note">
            <Icon name="cloud-off" size={15} />
            <span>
              Cerraste sesión: ninguna biblioteca de cuenta está visible en este navegador. Tu música sigue guardada y vuelve a aparecer cuando{' '}
              <button type="button" className="btn btn-link" onClick={() => account.openDialog('sign-in')}>
                iniciás sesión
              </button>
              .
            </span>
          </p>
        )}

        {account.status.kind === 'local' && account.identityMode !== 'signed-out' && !bannerHidden && (
          <p className="local-note" role="note">
            <Icon name="cloud-off" size={15} />
            <span>
              Tus materiales se guardan solo en este dispositivo.{' '}
              <button type="button" className="btn btn-link" onClick={() => account.openDialog('sign-in')}>
                Iniciá sesión
              </button>{' '}
              para sincronizarlos con tu cuenta.
            </span>
            <button type="button" className="icon-btn" aria-label="Ocultar este aviso" onClick={() => setBannerHidden(true)}>
              <Icon name="close" size={14} />
            </button>
          </p>
        )}

        {current?.kind === 'song' && (
          <div className="song-head">
            <Glyph kind="song" />
            <div>
              <strong>{current.name}</strong>
              <span className="muted small">Canción · {countIn(current)} {countIn(current) === 1 ? 'parte' : 'partes'}</span>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setSharing({ kind: 'node', id: current.id, title: current.name, nodeKind: 'song' })}>
              <Icon name="share" size={14} /> Compartir proyecto
            </button>
            <button type="button" className="btn" onClick={() => void createFrom('riff')}>
              <Icon name="plus" size={14} /> Agregar parte
            </button>
          </div>
        )}

        {everything === 0 && !text && folderId === null ? (
          <div className="lib-empty scenic">
            <StudioScene variant="compact" />
            <h2>Tu estudio está vacío</h2>
            <p>Empezá por lo que tengas en la cabeza hoy: una melodía, una letra, un riff o una escala.</p>
            <div className="empty-actions">
              <button type="button" className="btn btn-primary" onClick={() => void createFrom('composition')}>
                <Icon name="song" size={14} /> Empezar una canción
              </button>
              <button type="button" className="btn" onClick={() => void createFrom('melody')}>
                <Icon name="melody" size={14} /> Escribir una melodía
              </button>
              <button type="button" className="btn" onClick={() => void createFrom('riff')}>
                <Icon name="tab" size={14} /> Escribir una tablatura
              </button>
              <button type="button" className="btn" onClick={() => void createFrom('scale')}>
                <Icon name="map" size={14} /> Marcar una escala
              </button>
              <button type="button" className="btn" onClick={() => void createFrom('empty')}>
                <Icon name="mixed" size={14} /> Empezar un cuaderno vacío
              </button>
            </div>
          </div>
        ) : (
          text ? (
          <ul className="lib-list" aria-label={text ? 'Resultados de la búsqueda' : 'Contenido'}>
              {children.map((node) => (
                <li key={node.id} className={`lib-row node kind-${node.kind}`} style={{ ['--hue' as string]: hueOf(node.name) }}>
                  <button type="button" className="lib-open" onClick={() => goTo(node.id)}>
                    <Glyph kind={node.kind} />
                    <span className="lib-title">{node.name}</span>
                    {shared.has(node.id) && <span className="lib-shared" role="img" aria-label="Compartida" title="Compartida"><Icon name="users" size={13} /></span>}
                    <span className="lib-meta">
                      {kindInfo[node.kind].label} · {countIn(node)} {countIn(node) === 1 ? 'elemento' : 'elementos'}
                    </span>
                    <span className="lib-date">{when(node.updatedAt)}</span>
                  </button>
                  <Menu
                    label={`Opciones de ${node.name}`}
                    align="end"
                    triggerClassName="icon-btn row-menu"
                    trigger={<Icon name="more" />}
                    items={[
                      { label: 'Abrir', icon: 'folder', onSelect: () => goTo(node.id) },
                      { label: 'Renombrar', icon: 'pencil', onSelect: () => setNaming({ mode: 'rename-node', id: node.id, initial: node.name }) },
                      { label: 'Duplicar', icon: 'copy', onSelect: () => void libraryRepository.duplicateNode(node.id) },
                      { label: 'Mover a…', onSelect: () => setMoving({ kind: 'node', id: node.id, title: node.name, from: node.parentId }) },
                      { label: node.kind === 'song' ? 'Compartir proyecto…' : 'Compartir carpeta…', icon: 'share', onSelect: () => setSharing({ kind: 'node', id: node.id, title: node.name, nodeKind: node.kind === 'song' ? 'song' : 'folder' }) },
                      {
                        label: 'Enviar a la papelera',
                        icon: 'trash',
                        danger: true,
                        onSelect: () => void libraryRepository.trashNode(node.id).then(() => toast.show(`«${node.name}» está en la papelera.`, { label: 'Deshacer', onAction: () => void libraryRepository.restoreNode(node.id) })),
                      },
                    ]}
                  />
                </li>
              ))}
              {items.map((item) => {
                const kind = documentKind(item);
                return (
                  <li key={item.id} className={`lib-row doc kind-${kind}`}>
                    <button type="button" className="lib-open" onClick={() => open(item)}>
                      <Glyph kind={kind} />
                      <span className="lib-title">{item.title || 'Sin título'}</span>
                      {shared.has(item.id) && <span className="lib-shared" role="img" aria-label="Compartido" title="Compartido"><Icon name="users" size={13} /></span>}
                      <span className="lib-meta">
                        {kindInfo[kind].label}
                        {text || current === null ? (pathOf(nodes, item.songId ?? item.nodeId) ? ` · ${pathOf(nodes, item.songId ?? item.nodeId)}` : '') : ''}
                      </span>
                      <span className="lib-date">{when(item.updatedAt)}</span>
                    </button>
                    <Menu
                      label={`Opciones de ${item.title || 'material sin título'}`}
                      align="end"
                      triggerClassName="icon-btn row-menu"
                      trigger={<Icon name="more" />}
                      items={[
                        { label: 'Abrir', icon: 'pencil', onSelect: () => open(item) },
                        { label: 'Practicar', icon: 'practice', onSelect: () => navigate(`/practica/${item.id}`) },
                        { label: 'Renombrar', onSelect: () => setNaming({ mode: 'rename-doc', id: item.id, initial: item.title }) },
                        { label: 'Compartir…', icon: 'share', onSelect: () => setSharing({ kind: 'document', id: item.id, title: item.title, project: partOf(item) }) },
                        { label: 'Duplicar', icon: 'copy', onSelect: () => void libraryRepository.duplicateDocument(item.id) },
                        { label: 'Mover a…', onSelect: () => setMoving({ kind: 'doc', id: item.id, title: item.title, from: item.nodeId }) },
                        {
                          label: 'Enviar a la papelera',
                          icon: 'trash',
                          danger: true,
                          onSelect: () => void libraryRepository.trashDocument(item.id).then(() => toast.show(`«${item.title || 'Material'}» está en la papelera.`, { label: 'Deshacer', onAction: () => void libraryRepository.restoreDocument(item.id) })),
                        },
                      ]}
                    />
                  </li>
                );
              })}
              {!children.length && !items.length && (
                <li className="lib-none">
                  {text ? 'No encontramos materiales con ese nombre.' : 'Todavía no hay nada acá.'}
                  {!text && (
                    <span className="empty-actions inline">
                      <button type="button" className="btn btn-link" onClick={() => void createFrom('riff')}>
                        Escribir una tablatura
                      </button>
                      <button type="button" className="btn btn-link" onClick={() => void createFrom('scale')}>
                        Marcar una escala
                      </button>
                    </span>
                  )}
                </li>
              )}
            </ul>
          ) : (
            <FolderView
              folder={{
                id: folderId,
                name: current?.name ?? 'Biblioteca',
                kind: current ? (current.kind === 'song' ? 'song' : 'folder') : 'root',
                shared: current ? shared.has(current.id) : false,
                hue: hueOf(current?.name ?? 'Biblioteca'),
              }}
              entries={entries}
              presentation={folderId === null ? { ...presentation, modules: presentation.modules.filter((key) => key !== 'header') } : presentation}
              featuredIds={featuredIds}
              onShare={current ? () => setSharing({ kind: 'node', id: current.id, title: current.name, nodeKind: current.kind === 'song' ? 'song' : 'folder' }) : undefined}
              header={
                <>
                  <button type="button" className="btn btn-primary" onClick={() => setNewSong(true)}><Icon name="song" size={14} /> Nueva canción</button>
                  <button type="button" className="btn" onClick={() => void createFrom('melody')}><Icon name="melody" size={14} /> Melodía</button>
                  <button type="button" className="btn" onClick={() => void createFrom('scale')}><Icon name="map" size={14} /> Escala</button>
                  <button type="button" className="btn btn-ghost" onClick={() => (customizing ? setCustomizing(null) : startCustomizing())}><Icon name="palette" size={14} /> Personalizar</button>
                </>
              }
              emptyActions={
                <>
                  <button type="button" className="btn btn-link" onClick={() => setNewSong(true)}><Icon name="plus" size={13} /> Nueva canción</button>
                  <button type="button" className="btn btn-link" onClick={() => void createFrom('riff')}>Escribir una tablatura</button>
                  <button type="button" className="btn btn-link" onClick={() => void createFrom('scale')}>Marcar una escala</button>
                </>
              }
              actions={{
                open: (entry) => (entry.type === 'node' ? goTo(entry.id) : navigate(`/material/${entry.id}`)),
                practice: (entry) => navigate(`/practica/${entry.id}`),
                isFeatured: (entry) => featuredIds.includes(entry.id),
                toggleFeatured,
                menu: (entry) => (entry.node ? nodeMenu(entry.node) : entry.doc ? docMenu(entry.doc) : null),
              }}
            />
          )
        )}
      </section>

      {customizing && (
        <CustomizePanel
          folderName={current?.name ?? 'Biblioteca'}
          parentName={folderId && parentNode ? parentNode.name : null}
          isRoot={folderId === null}
          mode={customizing.mode}
          setMode={(mode) => setCustomizing((value) => (value ? { ...value, mode, draft: mode === 'own' ? value.draft : clonePresentation(mode === 'default' ? DEFAULT_PRESENTATION : resolvePresentation({ ...presentations, [folderKey]: { mode: 'inherit' } }, folderId, parentOf).presentation) } : value))}
          draft={customizing.draft}
          setDraft={(draft) => setCustomizing((value) => (value ? { ...value, draft } : value))}
          available={available}
          folders={nodes.filter((node) => node.kind === 'folder' && node.id !== folderId && !node.deletedAt).map((node) => ({ id: node.id, path: pathOf(nodes, node.id) }))}
          hasChildren={folderId !== null && nodes.some((node) => node.parentId === folderId)}
          onCancel={() => setCustomizing(null)}
          onSave={saveCustomizing}
          onCopyTo={(id) => {
            setPresentations({ ...presentations, [id]: { mode: 'own', presentation: clonePresentation(customizing.draft) } });
            toast.show(`Se copió la presentación a «${nodes.find((node) => node.id === id)?.name ?? 'la carpeta'}».`);
          }}
          onApplyToChildren={() => {
            if (!folderId) return;
            const next = applyToDescendants({ ...presentations, [folderKey]: { mode: 'own', presentation: clonePresentation(customizing.draft) } }, folderId, (id) => nodes.filter((node) => node.parentId === id).map((node) => node.id));
            setPresentations(next);
            setCustomizing((value) => (value ? { ...value, mode: 'own' } : value));
            toast.show('Las subcarpetas ahora heredan esta presentación.');
          }}
        />
      )}
      {metaFor && (
        <MetaDialog
          doc={metaFor}
          onClose={() => setMetaFor(null)}
          onSave={async (next) => {
            await libraryRepository.saveDocument(next, 'manual');
            setMetaFor(null);
            toast.show('Ficha guardada. La música no cambió.');
          }}
        />
      )}
      {sharing && (
        <Suspense fallback={null}>
          <ShareDialog kind={sharing.kind} id={sharing.id} title={sharing.title} project={sharing.project} nodeKind={sharing.nodeKind} onClose={() => setSharing(null)} />
        </Suspense>
      )}
      {newSong && (
        <NewSongDialog
          onClose={() => setNewSong(false)}
          onCreate={(input) => {
            const song = current?.kind === 'song' ? current : null;
            void libraryRepository.createSong(input, song ? song.parentId : folderId, song?.id ?? null).then((created) => navigate(`/material/${created.id}`));
            setNewSong(false);
          }}
        />
      )}
      {naming && (
        <NameDialog
          naming={naming}
          onClose={() => setNaming(null)}
          onSubmit={async (name) => {
            if (naming.mode === 'folder' || naming.mode === 'song') {
              const parent = current?.kind === 'song' ? current.parentId : folderId;
              await libraryRepository.createNode(name, naming.mode, parent);
            } else if (naming.mode === 'rename-node' && naming.id) {
              await libraryRepository.updateNode(naming.id, { name });
            } else if (naming.mode === 'rename-doc' && naming.id) {
              const target = documents.find((item) => item.id === naming.id);
              if (target) await libraryRepository.saveDocument({ ...target, title: name }, 'manual');
            }
            setNaming(null);
          }}
        />
      )}
      {moving && (
        <MoveDialog
          nodes={nodes}
          subject={moving}
          onClose={() => setMoving(null)}
          onMove={async (location) => {
            try {
              if (moving.kind === 'doc') await libraryRepository.moveDocument(moving.id, location);
              else await libraryRepository.moveNode(moving.id, location);
            } finally {
              setMoving(null);
            }
          }}
        />
      )}
    </div>
  );
}

function Tree({
  nodes,
  parentId,
  depth,
  selectedId,
  expanded,
  onToggle,
  onSelect,
  onMenu,
}: {
  nodes: LibraryNode[];
  parentId: string | null;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onMenu: (node: LibraryNode) => void;
}) {
  return (
    <ul className="tree" role={depth === 0 ? 'tree' : 'group'}>
      {nodes
        .filter((node) => node.parentId === parentId)
        .map((node) => {
          const hasChildren = nodes.some((item) => item.parentId === node.id);
          const opened = expanded.has(node.id);
          return (
            <li key={node.id} role="treeitem" aria-expanded={hasChildren ? opened : undefined} aria-selected={selectedId === node.id}>
              <div className={`tree-row${selectedId === node.id ? ' selected' : ''}`} style={{ paddingLeft: `${6 + depth * 14}px` }}>
                {hasChildren ? (
                  <button type="button" className="tree-toggle" aria-label={`${opened ? 'Contraer' : 'Expandir'} ${node.name}`} onClick={() => onToggle(node.id)}>
                    <Icon name={opened ? 'chevron-down' : 'chevron-right'} size={12} />
                  </button>
                ) : (
                  <span className="tree-spacer" />
                )}
                <button type="button" className="tree-name" onClick={() => onSelect(node.id)}>
                  <Icon name={node.kind === 'song' ? 'song' : 'folder'} size={14} />
                  <span>{node.name}</span>
                </button>
                <button type="button" className="tree-menu" aria-label={`Renombrar ${node.name}`} onClick={() => onMenu(node)}>
                  <Icon name="pencil" size={12} />
                </button>
              </div>
              {hasChildren && opened && (
                <Tree nodes={nodes} parentId={node.id} depth={depth + 1} selectedId={selectedId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} onMenu={onMenu} />
              )}
            </li>
          );
        })}
    </ul>
  );
}

function NameDialog({
  naming,
  onClose,
  onSubmit,
}: {
  naming: NonNullable<Naming>;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(naming.initial ?? '');
  const titles = { folder: 'Nueva carpeta', song: 'Nueva canción', 'rename-node': 'Cambiar nombre', 'rename-doc': 'Cambiar nombre' };
  return (
    <Dialog title={titles[naming.mode]} onClose={onClose} size="sm">
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void onSubmit(name.trim());
        }}
      >
        <label className="field">
          <span>Nombre</span>
          <input autoFocus value={name} placeholder={naming.mode === 'song' ? 'Ej. Comfortably Numb' : 'Ej. Escalas'} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            {naming.mode.startsWith('rename') ? 'Guardar' : 'Crear'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function MoveDialog({
  nodes,
  subject,
  onClose,
  onMove,
}: {
  nodes: LibraryNode[];
  subject: { kind: 'doc' | 'node'; id: string; title: string; from: string | null };
  onClose: () => void;
  onMove: (location: string | null) => Promise<void>;
}) {
  const [location, setLocation] = useState(subject.from ?? '');
  // A folder cannot be moved into itself or into one of its own subfolders.
  const blocked = new Set<string>();
  if (subject.kind === 'node') {
    const visit = (id: string) => {
      blocked.add(id);
      nodes.filter((node) => node.parentId === id).forEach((node) => visit(node.id));
    };
    visit(subject.id);
  }
  return (
    <Dialog title={`Mover «${subject.title || 'Sin título'}»`} onClose={onClose} size="sm">
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onMove(location || null);
        }}
      >
        <label className="field">
          <span>Carpeta de destino</span>
          <select autoFocus value={location} onChange={(event) => setLocation(event.target.value)}>
            <option value="">Biblioteca (raíz)</option>
            {nodes
              .filter((node) => node.kind === 'folder' && !blocked.has(node.id))
              .map((node) => (
                <option key={node.id} value={node.id}>
                  {pathOf(nodes, node.id)}
                </option>
              ))}
          </select>
        </label>
        <p className="muted small">El contenido y su historial se conservan.</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Mover aquí
          </button>
        </div>
      </form>
    </Dialog>
  );
}
