import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { transport, useTransport } from '@/audio/engine';
import { chordsToSequence, melodyToSequence, tablatureToSequence } from '@/audio/plan';
import { useSoundPrefs } from '@/audio/useBlockPlayer';
import { toNotebook } from '@/core/notebook';
import type { FieldKey, ModuleKey, Presentation } from '@/core/presentation';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Cover } from '@/features/library/Cover';
import { groupEntries, sortEntries, type Entry } from '@/features/library/folder-entries';

export const KIND_INFO: Record<Entry['kind'], { icon: IconName; label: string }> = {
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
const STATUS: Record<NonNullable<Entry['status']>, string> = { idea: 'Idea', progress: 'En proceso', done: 'Terminada' };

export const when = (time: number) => {
  const days = Math.floor((Date.now() - time) / 86_400_000);
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  return new Date(time).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
};

/** Quick playback from the library: the first playable block, at the song's tempo. Listening never saves anything. */
function useQuickPlay() {
  const snapshot = useTransport();
  const prefs = useSoundPrefs();
  const playingId = snapshot.state === 'playing' && snapshot.owner?.startsWith('lib:') ? snapshot.owner.slice(4) : null;
  const play = (entry: Entry) => {
    if (!entry.doc) return;
    if (playingId === entry.id) {
      transport.stop();
      return;
    }
    const notebook = toNotebook(entry.doc);
    for (const block of notebook.blocks) {
      const bpm = (block.kind === 'melody' || block.kind === 'chords' || block.kind === 'tablature' ? block.content.bpm : undefined) ?? notebook.meta?.bpm ?? 96;
      if (block.kind === 'melody' && block.content.events.some((event) => event.type === 'note')) {
        void transport.play({ owner: `lib:${entry.id}`, sequence: melodyToSequence(block.content), bpm, instrument: block.content.instrument ?? prefs.instrumentFor('melody') });
        return;
      }
      if (block.kind === 'chords' && block.content.items.length) {
        void transport.play({ owner: `lib:${entry.id}`, sequence: chordsToSequence(block.content), bpm, instrument: block.content.instrument ?? prefs.instrumentFor('chords') });
        return;
      }
      if (block.kind === 'tablature' && block.content.columns.length) {
        void transport.play({ owner: `lib:${entry.id}`, sequence: tablatureToSequence(block.content), bpm, instrument: block.content.instrument ?? prefs.instrumentFor('tablature') });
        return;
      }
    }
  };
  return { playingId, play };
}

type Actions = {
  open: (entry: Entry) => void;
  practice: (entry: Entry) => void;
  menu: (entry: Entry) => ReactNode;
  toggleFeatured: (entry: Entry) => void;
  isFeatured: (entry: Entry) => boolean;
};

function Facts({ entry, fields, compact }: { entry: Entry; fields: Presentation['fields']; compact?: boolean }) {
  const on = (key: FieldKey) => fields[key];
  const facts: ReactNode[] = [];
  if (on('kind')) facts.push(<span key="kind" className="fact kind">{KIND_INFO[entry.kind].label}{entry.count !== undefined ? ` · ${entry.count}` : ''}</span>);
  if (on('artist') && entry.artist) facts.push(<span key="artist" className="fact artist">{entry.artist}{entry.album && !compact ? ` — ${entry.album}` : ''}{entry.year && !compact ? ` (${entry.year})` : ''}</span>);
  if (on('key') && entry.key) facts.push(<span key="key" className="fact key" title="Tonalidad">{entry.key}</span>);
  if (on('bpm') && entry.bpm) facts.push(<span key="bpm" className="fact bpm">{entry.bpm} BPM</span>);
  if (on('status') && entry.status) facts.push(<span key="status" className={`fact status s-${entry.status}`}>{STATUS[entry.status]}</span>);
  if (on('chords') && entry.chords) facts.push(<span key="chords" className="fact chords">{entry.chords.slice(0, compact ? 4 : 8).join(' · ')}</span>);
  if (on('tags') && entry.tags) facts.push(<span key="tags" className="fact tags">{entry.tags.map((tag) => `#${tag}`).join(' ')}</span>);
  if (on('collaborators') && entry.shared) facts.push(<span key="shared" className="fact shared"><Icon name="users" size={12} /> Compartido</span>);
  if (on('updated')) facts.push(<span key="updated" className="fact date">{when(entry.updatedAt)}</span>);
  if (on('created')) facts.push(<span key="created" className="fact date">Creado {when(entry.createdAt).toLocaleLowerCase()}</span>);
  return facts.length ? <span className="entry-facts">{facts}</span> : null;
}

function QuickButtons({ entry, fields, quick, actions }: { entry: Entry; fields: Presentation['fields']; quick: ReturnType<typeof useQuickPlay>; actions: Actions }) {
  return (
    <span className="quick">
      {fields.play && entry.playable && (
        <button type="button" className="icon-btn" aria-label={quick.playingId === entry.id ? `Detener ${entry.title}` : `Escuchar ${entry.title}`} onClick={() => quick.play(entry)}>
          <Icon name={quick.playingId === entry.id ? 'stop' : 'play'} size={14} />
        </button>
      )}
      {fields.practice && entry.type === 'doc' && (
        <button type="button" className="icon-btn" aria-label={`Practicar ${entry.title}`} title="Practicar" onClick={() => actions.practice(entry)}>
          <Icon name="practice" size={14} />
        </button>
      )}
      {entry.type === 'doc' && (
        <button type="button" className={`icon-btn star${actions.isFeatured(entry) ? ' on' : ''}`} aria-pressed={actions.isFeatured(entry)} aria-label={`${actions.isFeatured(entry) ? 'Quitar de destacados' : 'Destacar'} ${entry.title}`} onClick={() => actions.toggleFeatured(entry)}>
          ★
        </button>
      )}
      {actions.menu(entry)}
    </span>
  );
}

function CoverGrid({ entries, presentation, quick, actions, label, addTile }: { entries: Entry[]; presentation: Presentation; quick: ReturnType<typeof useQuickPlay>; actions: Actions; label: string; addTile?: ReactNode }) {
  return (
    <ul className="cover-grid" aria-label={label}>
      {entries.map((entry) => (
        <li key={entry.id} className={`cover-card kind-${entry.kind}`}>
          <button type="button" className="cover-open" onClick={() => actions.open(entry)} aria-label={`Abrir ${entry.title}`}>
            {presentation.fields.cover || entry.type === 'node' ? (
              entry.type === 'node' ? (
                <span className="sleeve sleeve-folder" style={{ ['--hue' as string]: entry.cover.hue }} aria-hidden="true"><Icon name={KIND_INFO[entry.kind].icon} size={28} /></span>
              ) : (
                <Cover title={entry.title} style={entry.cover.style} hue={entry.cover.hue} />
              )
            ) : null}
            <span className="cover-title">{entry.title}</span>
          </button>
          <Facts entry={entry} fields={presentation.fields} compact />
          {presentation.fields.notes && entry.notes && presentation.density === 'detailed' && <p className="entry-notes">{entry.notes}</p>}
          <QuickButtons entry={entry} fields={presentation.fields} quick={quick} actions={actions} />
        </li>
      ))}
      {addTile}
    </ul>
  );
}

function EntryList({ entries, presentation, quick, actions, label }: { entries: Entry[]; presentation: Presentation; quick: ReturnType<typeof useQuickPlay>; actions: Actions; label: string }) {
  return (
    <ul className="entry-list" aria-label={label}>
      {entries.map((entry) => (
        <li key={entry.id} className={`lib-row entry-row ${entry.type === "node" ? "node" : "doc"} kind-${entry.kind}`} style={{ ['--hue' as string]: entry.cover.hue }}>
          <button type="button" className="lib-open entry-open" onClick={() => actions.open(entry)}>
            {presentation.fields.cover && entry.type === 'doc' && presentation.density !== 'compact' ? (
              <Cover title={entry.title} style={entry.cover.style} hue={entry.cover.hue} size="sm" />
            ) : (
              <span className={`glyph kind-${entry.kind}`} aria-hidden="true"><Icon name={KIND_INFO[entry.kind].icon} size={16} /></span>
            )}
            <span className="lib-title entry-title">{entry.title}</span>
            <Facts entry={entry} fields={presentation.fields} compact={presentation.density === 'compact'} />
          </button>
          {presentation.fields.notes && entry.notes && presentation.density === 'detailed' && <p className="entry-notes">{entry.notes}</p>}
          <QuickButtons entry={entry} fields={presentation.fields} quick={quick} actions={actions} />
        </li>
      ))}
    </ul>
  );
}

export type FolderInfo = { id: string | null; name: string; kind: 'folder' | 'song' | 'root'; shared: boolean; hue: number };

/**
 * A folder as its presentation says: modules in the chosen order, each built only from real data.
 * With one item it still has a composed page (header, actions, the item large); with 500 it stays a list.
 */
export function FolderView({ folder, entries, presentation, featuredIds, actions, header, emptyActions, onShare }: {
  folder: FolderInfo;
  entries: Entry[];
  presentation: Presentation;
  featuredIds: string[];
  actions: Actions;
  /** Buttons for the header (create, customise). */
  header: ReactNode;
  emptyActions: ReactNode;
  onShare?: () => void;
}) {
  const quick = useQuickPlay();
  const sorted = useMemo(() => sortEntries(entries, presentation.sort), [entries, presentation.sort]);
  const docs = sorted.filter((entry) => entry.type === 'doc');
  const recent = useMemo(() => [...docs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5), [docs]);
  const featured = featuredIds.map((id) => entries.find((entry) => entry.id === id)).filter((entry): entry is Entry => Boolean(entry));
  const few = entries.length <= 3;
  const hasModule = (key: ModuleKey) => presentation.modules.includes(key);
  // A folder must always show its contents: if neither covers nor list is on, the list is shown anyway.
  const modules: ModuleKey[] = hasModule('covers') || hasModule('list') ? presentation.modules : [...presentation.modules, 'list'];

  const keys = new Map<string, number>();
  docs.forEach((entry) => entry.key && keys.set(entry.key, (keys.get(entry.key) ?? 0) + 1));
  const bpms = docs.map((entry) => entry.bpm).filter((bpm): bpm is number => Boolean(bpm));
  const statuses = new Map<string, number>();
  docs.forEach((entry) => entry.status && statuses.set(STATUS[entry.status], (statuses.get(STATUS[entry.status]) ?? 0) + 1));
  const sharedEntries = entries.filter((entry) => entry.shared);

  const render = (key: ModuleKey): ReactNode => {
    switch (key) {
      case 'header':
        return (
          <header className={`folder-hero${few ? ' roomy' : ''}`} style={{ ['--hue' as string]: folder.hue }}>
            <div className="folder-hero-art" aria-hidden="true">
              {docs.slice(0, 4).map((entry) => <Cover key={entry.id} title={entry.title} style={entry.cover.style} hue={entry.cover.hue} size="sm" />)}
              {docs.length === 0 && <span className="folder-hero-glyph"><Icon name={folder.kind === 'song' ? 'song' : 'folder'} size={34} /></span>}
            </div>
            <div className="folder-hero-text">
              <p className="hero-kicker">{folder.kind === 'song' ? 'Proyecto de canción' : folder.kind === 'root' ? 'Tu biblioteca' : 'Carpeta'}{folder.shared ? ' · compartida' : ''}</p>
              <h2 className="folder-hero-title">{folder.name}</h2>
              <p className="folder-hero-sub">
                {entries.length === 0 ? 'Vacía por ahora.' : [
                  docs.length ? `${docs.length} ${docs.length === 1 ? 'material' : 'materiales'}` : '',
                  entries.length - docs.length ? `${entries.length - docs.length} ${entries.length - docs.length === 1 ? 'carpeta' : 'carpetas'}` : '',
                  recent[0] ? `último cambio: ${when(recent[0].updatedAt).toLocaleLowerCase()}` : '',
                ].filter(Boolean).join(' · ')}
              </p>
              <div className="folder-hero-actions">{header}</div>
            </div>
          </header>
        );
      case 'description':
        return presentation.description ? <p className="folder-description">{presentation.description}</p> : null;
      case 'featured':
        return featured.length ? (
          <section className="folder-module" aria-label="Destacados">
            <h3 className="module-title">Destacados</h3>
            <CoverGrid entries={featured} presentation={presentation} quick={quick} actions={actions} label="Materiales destacados" />
          </section>
        ) : null;
      case 'covers':
        return entries.length ? (
          <section className="folder-module" aria-label="Portadas">
            {groupEntries(sorted, presentation.group).map((group) => (
              <div key={group.name ?? 'all'} className="entry-group">
                {group.name && <h3 className="module-title">{group.name}</h3>}
                <CoverGrid entries={group.items} presentation={presentation} quick={quick} actions={actions} label={group.name ?? 'Portadas'} addTile={few && !group.name ? <li className="cover-card add">{emptyActions}</li> : undefined} />
              </div>
            ))}
          </section>
        ) : null;
      case 'list':
        return entries.length ? (
          <section className="folder-module" aria-label="Lista">
            {groupEntries(sorted, presentation.group).map((group) => (
              <div key={group.name ?? 'all'} className="entry-group">
                {group.name && <h3 className="module-title">{group.name} <span className="muted small">{group.items.length}</span></h3>}
                <EntryList entries={group.items} presentation={presentation} quick={quick} actions={actions} label={group.name ?? 'Contenido'} />
              </div>
            ))}
          </section>
        ) : null;
      case 'recent':
        return recent.length > 1 ? (
          <section className="folder-module recent-strip" aria-label="Recientes de la carpeta">
            <h3 className="module-title">Recientes</h3>
            <div className="recent-row">
              {recent.map((entry) => (
                <Link key={entry.id} className="recent-chip" to={`/material/${entry.id}`}>
                  <Icon name={KIND_INFO[entry.kind].icon} size={13} /> {entry.title} <span className="muted small">{when(entry.updatedAt)}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null;
      case 'practice':
        return docs.length ? (
          <section className="folder-module" aria-label="Accesos de práctica">
            <h3 className="module-title">Practicar</h3>
            <div className="recent-row">
              {docs.slice(0, 8).map((entry) => (
                <Link key={entry.id} className="recent-chip practice" to={`/practica/${entry.id}`}><Icon name="practice" size={13} /> {entry.title}</Link>
              ))}
              <Link className="recent-chip" to="/practica">Todo en Práctica →</Link>
            </div>
          </section>
        ) : null;
      case 'music':
        return keys.size || bpms.length || statuses.size ? (
          <section className="folder-module music-facts" aria-label="Información musical">
            <h3 className="module-title">Información musical</h3>
            <dl>
              {keys.size > 0 && (<><dt>Tonalidades</dt><dd>{[...keys].map(([key, count]) => `${key}${count > 1 ? ` ×${count}` : ''}`).join(' · ')}</dd></>)}
              {bpms.length > 0 && (<><dt>Tempo</dt><dd>{Math.min(...bpms) === Math.max(...bpms) ? `${bpms[0]} BPM` : `${Math.min(...bpms)}–${Math.max(...bpms)} BPM`}</dd></>)}
              {statuses.size > 0 && (<><dt>Estado</dt><dd>{[...statuses].map(([name, count]) => `${name}: ${count}`).join(' · ')}</dd></>)}
            </dl>
            <p className="muted small">Solo lo que tus materiales tienen cargado.</p>
          </section>
        ) : null;
      case 'shared':
        return (
          <section className="folder-module" aria-label="Compartido">
            <h3 className="module-title">Compartido</h3>
            {folder.shared || sharedEntries.length ? (
              <p className="small">{folder.shared ? 'Esta carpeta está compartida. ' : ''}{sharedEntries.length ? `Compartidos desde acá: ${sharedEntries.map((entry) => entry.title).join(', ')}.` : ''}</p>
            ) : (
              <p className="muted small">Nada compartido todavía.</p>
            )}
            {onShare && <button type="button" className="btn btn-link" onClick={onShare}><Icon name="share" size={13} /> Compartir…</button>}
          </section>
        );
    }
  };

  return (
    <div className={`folder-view density-${presentation.density}`} data-preset={presentation.preset}>
      {modules.map((key) => {
        const node = render(key);
        return node ? <div key={key} className={`module module-${key}`}>{node}</div> : null;
      })}
      {entries.length === 0 && (
        <div className="folder-empty">
          <p>Todavía no hay nada acá. Empezá por lo que tengas en la cabeza:</p>
          <div className="empty-actions">{emptyActions}</div>
        </div>
      )}
    </div>
  );
}
