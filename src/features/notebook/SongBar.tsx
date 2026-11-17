import type { NotebookContent, SongMeta } from '@/core/model';
import { setMeta } from '@/core/notebook';
import { allKeys, keyTitle, type KeyRef } from '@/core/theory/keys';
import { Icon } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';
import { Segmented } from '@/components/ui/Segmented';
import { useNoteStyle } from '@/features/melody/note-style';
import { CommentButton } from '@/features/notebook/comments';

const STATUS = { idea: 'Idea', progress: 'En progreso', done: 'Terminada' } as const;

/**
 * The few things worth knowing about a song, in one quiet line: key, tempo, status, notes about the whole
 * notebook. All optional and none of them rewrites the music: choosing a key never transposes anything.
 */
export function SongBar({
  notebook,
  readOnly,
  change,
}: {
  notebook: NotebookContent;
  readOnly: boolean;
  change: (update: (notebook: NotebookContent) => NotebookContent) => void;
}) {
  const [style] = useNoteStyle();
  const meta: SongMeta = notebook.meta ?? {};
  const patch = (next: Partial<SongMeta>) => change((current) => setMeta(current, next));
  const keyValue = meta.key ? `${meta.key.tonic}:${meta.key.mode}` : '';

  if (readOnly) {
    const parts = [meta.key && keyTitle(meta.key as KeyRef, style), meta.bpm && `${meta.bpm} BPM`, meta.status && STATUS[meta.status]].filter(Boolean);
    return parts.length ? <p className="song-bar static muted small">{parts.join(' · ')}</p> : null;
  }

  return (
    <div className="song-bar nb-chrome" role="group" aria-label="Datos de la canción">
      <Popover
        label="Tonalidad del cuaderno"
        triggerClassName={`chip${meta.key ? ' set' : ''}`}
        trigger={<>Tonalidad <strong>{meta.key ? keyTitle(meta.key as KeyRef, style) : '—'}</strong><Icon name="chevron-down" size={12} /></>}
      >
        {(close) => (
          <div className="pop-stack">
            <label className="field">
              <span>Tonalidad principal</span>
              <select
                aria-label="Tonalidad principal"
                value={keyValue}
                onChange={(event) => {
                  if (!event.target.value) patch({ key: undefined });
                  else {
                    const [tonic, mode] = event.target.value.split(':');
                    patch({ key: { tonic, mode: mode as 'major' | 'minor' } });
                  }
                }}
              >
                <option value="">Sin definir</option>
                {allKeys().map((key) => (<option key={`${key.tonic}:${key.mode}`} value={`${key.tonic}:${key.mode}`}>{keyTitle(key, style)}</option>))}
              </select>
            </label>
            <p className="muted small">Sirve de contexto para mostrar grados y acordes. Cambiarla no transpone melodías, solos ni tablaturas: eso se hace aparte, a propósito.</p>
            <button type="button" className="btn" onClick={close}>Listo</button>
          </div>
        )}
      </Popover>
      <label className="chip bpm-chip" title="Tempo del cuaderno. Cada bloque puede tener el suyo.">
        <span>Tempo</span>
        <input
          aria-label="Tempo del cuaderno"
          type="number"
          inputMode="numeric"
          min={30}
          max={280}
          placeholder="—"
          value={meta.bpm ?? ''}
          onChange={(event) => patch({ bpm: event.target.value ? Math.max(30, Math.min(280, Math.round(Number(event.target.value)))) : undefined })}
        />
        <span>BPM</span>
      </label>
      <Popover
        label="Estado de la canción"
        triggerClassName="chip"
        trigger={<>Estado <strong>{meta.status ? STATUS[meta.status] : '—'}</strong><Icon name="chevron-down" size={12} /></>}
      >
        {() => (
          <div className="pop-stack">
            <Segmented<'idea' | 'progress' | 'done'>
              label="Estado"
              value={meta.status ?? 'idea'}
              onChange={(status) => patch({ status })}
              options={[{ value: 'idea', label: 'Idea' }, { value: 'progress', label: 'En progreso' }, { value: 'done', label: 'Terminada' }]}
            />
            {meta.status && <button type="button" className="btn btn-link" onClick={() => patch({ status: undefined })}>Quitar estado</button>}
          </div>
        )}
      </Popover>
      <span className="spacer" />
      <CommentButton label="el cuaderno" className="btn btn-ghost" forceVisible />
    </div>
  );
}
