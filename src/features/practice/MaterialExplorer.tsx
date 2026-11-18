import { useEffect, useMemo, useState } from 'react';
import type { LibraryNode, MusicalDocument } from '@/core/model';
import { documentKind } from '@/core/notebook';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';
import { pathOf } from '@/data/paths';
import { collabApi } from '@/features/share/collab-api';
import { useCollabState, useGateway } from '@/features/share/use-collab';
import { countBelow, levelOf, locationOf, searchMaterials } from '@/features/practice/practice-tree';

const kindIcon: Record<ReturnType<typeof documentKind>, IconName> = { tablature: 'tab', map: 'map', mixed: 'mixed', melody: 'melody', lyrics: 'lyrics', chords: 'chords', composition: 'song' };
type Shared = Awaited<ReturnType<typeof collabApi.sharedWithMe>>;

/**
 * Chooses what to practice by walking the library the way it is organised: folders, songs, then their parts.
 * It reads the same nodes and documents as the Library screen. Materials other people shared with this account
 * live in their own tab and are never mixed with the person's own.
 */
export function MaterialExplorer({
  nodes,
  documents,
  current,
  currentShared,
  onPick,
  onPickShared,
}: {
  nodes: LibraryNode[];
  documents: MusicalDocument[];
  current?: MusicalDocument;
  currentShared?: { id: string; title: string };
  onPick: (id: string) => void;
  onPickShared: (id: string) => void;
}) {
  const where = current ? pathOf(nodes, current.songId ?? current.nodeId) : '';
  return (
    <Popover
      label="Elegir material para practicar"
      triggerClassName="btn picker explorer-trigger"
      trigger={
        <>
          <Icon name={current ? kindIcon[documentKind(current)] : currentShared ? 'users' : 'library'} size={14} />
          <span className="picker-name">
            {where && <span className="picker-path">{where} ›</span>}
            {current?.title || currentShared?.title || 'Elegí un material'}
          </span>
          <Icon name="chevron-down" size={12} />
        </>
      }
    >
      {(close) => (
        <Explorer
          nodes={nodes}
          documents={documents}
          current={current}
          onPick={(id) => {
            onPick(id);
            close();
          }}
          onPickShared={(id) => {
            onPickShared(id);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function Explorer({ nodes, documents, current, onPick, onPickShared }: { nodes: LibraryNode[]; documents: MusicalDocument[]; current?: MusicalDocument; onPick: (id: string) => void; onPickShared: (id: string) => void }) {
  const [at, setAt] = useState<string | null>(() => locationOf(nodes, current));
  const [tab, setTab] = useState<'mine' | 'shared'>('mine');
  const [query, setQuery] = useState('');
  const collab = useCollabState();
  const level = useMemo(() => levelOf(nodes, documents, at), [nodes, documents, at]);
  const hits = useMemo(() => searchMaterials(nodes, documents, query), [nodes, documents, query]);
  const recent = documents.slice(0, 5);
  const parent = level.at ? (level.trail.at(-2) ?? null) : null;

  return (
    <div className="explorer" role="group" aria-label="Explorador de materiales">
      {collab === 'ready' && (
        <div className="explorer-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>Mi biblioteca</button>
          <button type="button" role="tab" aria-selected={tab === 'shared'} className={tab === 'shared' ? 'on' : ''} onClick={() => setTab('shared')}>Compartidos conmigo</button>
        </div>
      )}
      {tab === 'shared' ? (
        <SharedList onPick={onPickShared} />
      ) : (
        <>
          <input autoFocus type="search" className="explorer-search" aria-label="Buscar material para practicar" placeholder="Buscar en toda la biblioteca…" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query.trim() ? (
            <ul className="explorer-list" aria-label="Resultados">
              {hits.map(({ document, where }) => (
                <li key={document.id}>
                  <button type="button" className={document.id === current?.id ? 'on' : ''} onClick={() => onPick(document.id)}>
                    <Icon name={kindIcon[documentKind(document)]} size={14} />
                    <span className="ex-name">{document.title || 'Sin título'}</span>
                    {where && <span className="ex-meta">{where}</span>}
                  </button>
                </li>
              ))}
              {!hits.length && <li className="muted small pad">Sin resultados.</li>}
            </ul>
          ) : (
            <>
              <nav className="explorer-crumbs" aria-label="Ubicación">
                {level.at && (
                  <button type="button" className="icon-btn" aria-label={`Subir a ${parent?.name ?? 'la biblioteca'}`} onClick={() => setAt(parent?.id ?? null)}>
                    <Icon name="chevron-left" size={14} />
                  </button>
                )}
                <button type="button" className="crumb" onClick={() => setAt(null)} aria-current={!level.at ? 'location' : undefined}>Biblioteca</button>
                {level.trail.map((node, index) => (
                  <span key={node.id}>
                    <Icon name="chevron-right" size={11} />
                    <button type="button" className="crumb" onClick={() => setAt(node.id)} aria-current={index === level.trail.length - 1 ? 'location' : undefined}>{node.name}</button>
                  </span>
                ))}
              </nav>
              <ul className="explorer-list" aria-label={level.at ? `Contenido de ${level.at.name}` : 'Contenido de la biblioteca'}>
                {level.nodes.map((node) => (
                  <li key={node.id}>
                    <button type="button" className="ex-folder" aria-label={`${node.kind === 'song' ? 'Canción' : 'Carpeta'} ${node.name}`} onClick={() => setAt(node.id)}>
                      <Icon name={node.kind === 'song' ? 'song' : 'folder'} size={14} />
                      <span className="ex-name">{node.name}</span>
                      <span className="ex-meta">{countBelow(nodes, documents, node)}</span>
                      <Icon name="chevron-right" size={12} />
                    </button>
                  </li>
                ))}
                {level.documents.map((document) => (
                  <li key={document.id}>
                    <button type="button" className={document.id === current?.id ? 'on' : ''} aria-current={document.id === current?.id ? 'true' : undefined} onClick={() => onPick(document.id)}>
                      <Icon name={kindIcon[documentKind(document)]} size={14} />
                      <span className="ex-name">{document.title || 'Sin título'}</span>
                    </button>
                  </li>
                ))}
                {!level.nodes.length && !level.documents.length && <li className="muted small pad">Todavía no hay nada acá.</li>}
              </ul>
              {!level.at && recent.length > 0 && (
                <section className="explorer-recent" aria-label="Recientes">
                  <h3>Recientes</h3>
                  <ul>
                    {recent.map((document) => (
                      <li key={document.id}>
                        <button type="button" onClick={() => onPick(document.id)}>
                          <Icon name={kindIcon[documentKind(document)]} size={13} />
                          <span className="ex-name">{document.title || 'Sin título'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** What other people shared with this account, grouped under their project (never mixed with the person's own library). */
function SharedList({ onPick }: { onPick: (id: string) => void }) {
  const gateway = useGateway();
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!gateway?.accessToken) return;
    let live = true;
    collabApi.sharedWithMe(gateway).then((value) => live && setData(value)).catch((failure) => live && setError(failure instanceof Error ? failure.message : 'No se pudo cargar.'));
    return () => {
      live = false;
    };
  }, [gateway]);
  if (error) return <p className="share-error" role="alert">{error}</p>;
  if (!data) return <p className="muted small pad" role="status">Cargando lo que te compartieron…</p>;
  const grouped = data.folders.map((folder) => ({ folder, parts: data.documents.filter((doc) => doc.project?.id === folder.id) }));
  const loose = data.documents.filter((doc) => !doc.project || !data.folders.some((folder) => folder.id === doc.project!.id));
  if (!grouped.length && !loose.length) return <p className="muted small pad">Todavía no te compartieron nada.</p>;
  return (
    <ul className="explorer-list" aria-label="Compartidos conmigo">
      {grouped.map(({ folder, parts }) => (
        <li key={folder.id} className="ex-group">
          <span className="ex-group-name"><Icon name={folder.kind === 'song' ? 'users' : 'folder'} size={13} /> {folder.name}</span>
          <ul aria-label={`Partes de ${folder.name}`}>
            {parts.map((doc) => (
              <li key={doc.id}>
                <button type="button" onClick={() => onPick(doc.id)}>
                  <Icon name="chevron-right" size={12} />
                  <span className="ex-name">{doc.title || 'Sin título'}</span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
      {loose.map((doc) => (
        <li key={doc.id}>
          <button type="button" onClick={() => onPick(doc.id)}>
            <Icon name="users" size={14} />
            <span className="ex-name">{doc.title || 'Sin título'}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
