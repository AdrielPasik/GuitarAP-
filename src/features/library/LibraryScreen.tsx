import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DocumentType, LibraryNode, MusicalDocument } from '@/core/model';
import { Dialog } from '@/components/ui/Dialog';
import { libraryRepository } from '@/data/library-repository';
import { useLibrary } from '@/data/use-library';

type Modal =
  | null
  | { kind: 'create'; type?: DocumentType | 'folder' | 'song' }
  | { kind: 'rename'; node: LibraryNode }
  | { kind: 'move'; document: MusicalDocument };
function destinationName(node?: LibraryNode) {
  return node ? (node.kind === 'song' ? `Canción · ${node.name}` : node.name) : 'Biblioteca raíz';
}

export function LibraryScreen() {
  const { nodes, documents } = useLibrary();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<Modal>(null);
  const selectedNode = nodes.find((node) => node.id === folderId);
  const matches = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    const scoped =
      selectedNode?.kind === 'song'
        ? documents.filter((item) => item.songId === selectedNode.id)
        : folderId
          ? documents.filter((item) => item.nodeId === folderId)
          : documents;
    return text ? scoped.filter((item) => item.title.toLocaleLowerCase().includes(text)) : scoped;
  }, [documents, folderId, query, selectedNode]);
  const open = (document: MusicalDocument) =>
    navigate(`/${document.type === 'tablature' ? 'tablaturas' : 'diapason'}/${document.id}`);
  async function create(
    type: DocumentType | 'folder' | 'song',
    name: string,
    location: string | null,
  ) {
    if (type === 'folder' || type === 'song') {
      await libraryRepository.createNode(name, type, location);
      return;
    }
    const locationNode = nodes.find((node) => node.id === location);
    const document = await libraryRepository.createDocument(
      type,
      name,
      locationNode?.kind === 'song' ? locationNode.parentId : location,
      locationNode?.kind === 'song' ? locationNode.id : null,
    );
    open(document);
  }
  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className="library-shell">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tu libreta musical</p>
          <h1>Biblioteca</h1>
          <p className="subtle">{destinationName(selectedNode)} · guardado en este dispositivo.</p>
        </div>
        <div className="action-row">
          <button className="control" onClick={() => setModal({ kind: 'create', type: 'folder' })}>
            Nueva carpeta
          </button>
          <button className="control" onClick={() => setModal({ kind: 'create', type: 'song' })}>
            Nueva canción
          </button>
          <button className="control-primary" onClick={() => setModal({ kind: 'create' })}>
            Nuevo material
          </button>
        </div>
      </div>
      <div className="library-grid">
        <aside className="library-tree">
          <div className="tree-heading">
            <span>Ubicaciones</span>
            <button
              className="icon-button"
              aria-label="Nueva subcarpeta"
              onClick={() => setModal({ kind: 'create', type: 'folder' })}
            >
              +
            </button>
          </div>
          <button
            className={`tree-root ${!folderId ? 'selected' : ''}`}
            onClick={() => setFolderId(null)}
          >
            ⌂ Toda la biblioteca
          </button>
          <Tree
            nodes={nodes}
            parentId={null}
            depth={0}
            selectedId={folderId}
            expanded={expanded}
            onToggle={toggleExpanded}
            onSelect={setFolderId}
            onMenu={(node) => setModal({ kind: 'rename', node })}
          />
        </aside>
        <main className="library-content">
          <div className="content-toolbar">
            <label className="search-field">
              <span>⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar en esta ubicación"
                aria-label="Buscar documentos"
              />
            </label>
            <span className="subtle">{matches.length} materiales</span>
          </div>
          {selectedNode?.kind === 'song' && (
            <div className="song-strip">
              <span>♫</span>
              <div>
                <strong>{selectedNode.name}</strong>
                <p>Partes, riffs, solos y diagramas de esta canción.</p>
              </div>
              <button className="control" onClick={() => setModal({ kind: 'create' })}>
                Agregar parte
              </button>
            </div>
          )}
          <div className="document-grid">
            {matches.map((document) => (
              <article key={document.id} className="document-card">
                <button className="document-open" onClick={() => open(document)}>
                  <span className={`document-icon ${document.type}`}>
                    {document.type === 'tablature' ? 'TAB' : '◉'}
                  </span>
                  <span>
                    <strong>{document.title}</strong>
                    <small>
                      {document.type === 'tablature'
                        ? 'Tablatura · secuencia musical'
                        : 'Mapa de notas · escala o posición'}{' '}
                      · {new Date(document.updatedAt).toLocaleDateString('es-AR')}
                    </small>
                  </span>
                </button>
                <div className="card-actions">
                  <button onClick={() => setModal({ kind: 'move', document })}>Mover a…</button>
                  <button onClick={() => void libraryRepository.duplicateDocument(document.id)}>
                    Duplicar
                  </button>
                  <button
                    className="danger"
                    onClick={() => void libraryRepository.trashDocument(document.id)}
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!matches.length && (
            <div className="empty-library">
              <span>♫</span>
              <h2>{query ? 'No encontramos material' : 'Empezá una idea nueva'}</h2>
              <p>
                {query
                  ? 'Probá otro nombre o ubicación.'
                  : `Creá una tablatura o un mapa de notas en ${destinationName(selectedNode).toLocaleLowerCase()}.`}
              </p>
              <button className="control-primary" onClick={() => setModal({ kind: 'create' })}>
                Crear material
              </button>
            </div>
          )}
        </main>
      </div>
      {modal?.kind === 'create' && (
        <CreateDialog
          nodes={nodes}
          initialType={modal.type}
          initialLocation={folderId}
          onClose={() => setModal(null)}
          onCreate={async (type, name, location) => {
            await create(type, name, location);
            setModal(null);
          }}
        />
      )}
      {modal?.kind === 'rename' && (
        <NodeDialog
          node={modal.node}
          onClose={() => setModal(null)}
          onRename={async (name) => {
            await libraryRepository.updateNode(modal.node.id, { name });
            setModal(null);
          }}
          onDuplicate={() => {
            void libraryRepository.duplicateNode(modal.node.id);
            setModal(null);
          }}
          onTrash={() => {
            void libraryRepository.trashNode(modal.node.id);
            setModal(null);
          }}
        />
      )}
      {modal?.kind === 'move' && (
        <MoveDialog
          nodes={nodes}
          document={modal.document}
          onClose={() => setModal(null)}
          onMove={async (location) => {
            await libraryRepository.moveDocument(modal.document.id, location);
            setModal(null);
          }}
        />
      )}
    </section>
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
    <div>
      {nodes
        .filter((node) => node.parentId === parentId)
        .map((node) => {
          const children = nodes.some((item) => item.parentId === node.id);
          const opened = expanded.has(node.id);
          return (
            <div key={node.id}>
              <div
                className={`tree-row ${selectedId === node.id ? 'selected' : ''}`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
              >
                {children ? (
                  <button
                    className="tree-toggle"
                    aria-label={`${opened ? 'Contraer' : 'Expandir'} ${node.name}`}
                    onClick={() => onToggle(node.id)}
                  >
                    {opened ? '⌄' : '›'}
                  </button>
                ) : (
                  <span className="tree-spacer" />
                )}
                <button className="tree-name" onClick={() => onSelect(node.id)}>
                  {node.kind === 'song' ? '♫' : '⌁'} {node.name}
                </button>
                <button
                  className="tree-menu"
                  aria-label={`Opciones de ${node.name}`}
                  onClick={() => onMenu(node)}
                >
                  •••
                </button>
              </div>
              {children && opened && (
                <Tree
                  nodes={nodes}
                  parentId={node.id}
                  depth={depth + 1}
                  selectedId={selectedId}
                  expanded={expanded}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  onMenu={onMenu}
                />
              )}
            </div>
          );
        })}
    </div>
  );
}

function CreateDialog({
  nodes,
  initialType,
  initialLocation,
  onClose,
  onCreate,
}: {
  nodes: LibraryNode[];
  initialType?: DocumentType | 'folder' | 'song';
  initialLocation: string | null;
  onClose: () => void;
  onCreate: (
    type: DocumentType | 'folder' | 'song',
    name: string,
    location: string | null,
  ) => Promise<void>;
}) {
  const [type, setType] = useState<DocumentType | 'folder' | 'song'>(initialType ?? 'tablature');
  const [name, setName] = useState('');
  const [location, setLocation] = useState(initialLocation ?? '');
  return (
    <Dialog title="Crear en la biblioteca" onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void onCreate(type, name, location || null);
        }}
      >
        <label>
          Tipo
          <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
            <option value="tablature">Tablatura · riff, solo o canción</option>
            <option value="fretboard">Mapa de notas · escala o posición</option>
            <option value="folder">Carpeta</option>
            <option value="song">Canción</option>
          </select>
        </label>
        {(type === 'tablature' || type === 'fretboard') && (
          <p className="creation-type-hint">
            {type === 'tablature'
              ? 'Secuencia temporal: escribí notas, acordes, técnicas y secciones en orden.'
              : 'Mapa espacial: marcá libremente todas las posiciones que quieras sobre el mástil.'}
          </p>
        )}
        <label>
          Nombre
          <input
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ej. Do mayor"
          />
        </label>
        <label>
          Ubicación
          <select value={location} onChange={(event) => setLocation(event.target.value)}>
            <option value="">Biblioteca raíz</option>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.kind === 'song' ? '♫ ' : ''}
                {node.name}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button type="button" className="control" onClick={onClose}>
            Cancelar
          </button>
          <button className="control-primary">Crear</button>
        </div>
      </form>
    </Dialog>
  );
}
function NodeDialog({
  node,
  onClose,
  onRename,
  onDuplicate,
  onTrash,
}: {
  node: LibraryNode;
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
  onDuplicate: () => void;
  onTrash: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(node.name);
  return (
    <Dialog title={renaming ? 'Cambiar nombre' : node.name} onClose={onClose}>
      {renaming ? (
        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) void onRename(name);
          }}
        >
          <label>
            Nombre
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="dialog-actions">
            <button type="button" className="control" onClick={() => setRenaming(false)}>
              Volver
            </button>
            <button className="control-primary">Guardar</button>
          </div>
        </form>
      ) : (
        <div className="menu-actions">
          <button onClick={() => setRenaming(true)}>Renombrar</button>
          <button onClick={onDuplicate}>Duplicar</button>
          <button className="danger" onClick={onTrash}>
            Enviar a papelera
          </button>
        </div>
      )}
    </Dialog>
  );
}
function MoveDialog({
  nodes,
  document,
  onClose,
  onMove,
}: {
  nodes: LibraryNode[];
  document: MusicalDocument;
  onClose: () => void;
  onMove: (location: string | null) => Promise<void>;
}) {
  const [location, setLocation] = useState(document.nodeId ?? '');
  return (
    <Dialog title={`Mover “${document.title}”`} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onMove(location || null);
        }}
      >
        <p className="subtle">El contenido y su historial se conservan.</p>
        <label>
          Carpeta de destino
          <select autoFocus value={location} onChange={(event) => setLocation(event.target.value)}>
            <option value="">Biblioteca raíz</option>
            {nodes
              .filter((node) => node.kind === 'folder')
              .map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button type="button" className="control" onClick={onClose}>
            Cancelar
          </button>
          <button className="control-primary">Mover aquí</button>
        </div>
      </form>
    </Dialog>
  );
}
