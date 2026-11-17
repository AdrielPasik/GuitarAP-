import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { LibraryNode, MusicalDocument } from '@/core/model';
import { documentKind, type DocumentKind } from '@/core/notebook';
import { usePref } from '@/core/prefs';
import { Dialog } from '@/components/ui/Dialog';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Menu } from '@/components/ui/Popover';
import { useToast } from '@/components/ui/toast-context';
import { libraryRepository, type MaterialTemplate } from '@/data/library-repository';
import { ancestry, pathOf } from '@/data/paths';
import { useLibrary } from '@/data/use-library';
import { useAccount } from '@/features/account/account-context';

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
  const [moving, setMoving] = useState<{ kind: 'doc' | 'node'; id: string; title: string; from: string | null } | null>(null);
  const [sort, setSort] = usePref<'recent' | 'name'>('library-sort', 'recent');
  const [bannerHidden, setBannerHidden] = usePref('local-banner-hidden', false);
  const current = nodes.find((node) => node.id === folderId) ?? null;
  const trail = useMemo(() => ancestry(nodes, folderId), [nodes, folderId]);
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
                {sort === 'recent' ? 'Recientes' : 'Nombre'} <Icon name="chevron-down" size={12} />
              </>
            }
            items={[
              { label: 'Más recientes primero', checked: sort === 'recent', onSelect: () => setSort('recent') },
              { label: 'Por nombre', checked: sort === 'name', onSelect: () => setSort('name') },
            ]}
          />
          {createMenu}
        </div>

        {account.status.kind === 'local' && !bannerHidden && (
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
              <span className="muted small">Canción · {countIn(current)} partes</span>
            </div>
            <button type="button" className="btn" onClick={() => void createFrom('riff')}>
              <Icon name="plus" size={14} /> Agregar parte
            </button>
          </div>
        )}

        {everything === 0 && !text ? (
          <div className="lib-empty">
            <h2>Tu cuaderno está vacío</h2>
            <p>Empezá por lo que quieras tocar hoy.</p>
            <div className="empty-actions">
              <button type="button" className="btn btn-primary" onClick={() => void createFrom('riff')}>
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
          <ul className="lib-list" aria-label={text ? 'Resultados de la búsqueda' : 'Contenido'}>
            {children.map((node) => (
              <li key={node.id} className="lib-row">
                <button type="button" className="lib-open" onClick={() => goTo(node.id)}>
                  <Glyph kind={node.kind} />
                  <span className="lib-title">{node.name}</span>
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
                <li key={item.id} className="lib-row">
                  <button type="button" className="lib-open" onClick={() => open(item)}>
                    <Glyph kind={kind} />
                    <span className="lib-title">{item.title || 'Sin título'}</span>
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
        )}
      </section>

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
