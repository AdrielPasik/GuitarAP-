import { useState } from 'react';
import { clampBpm } from '@/audio/tempo';
import type { KeySignature } from '@/core/model';
import { allKeys, keyTitle } from '@/core/theory/keys';
import { Dialog } from '@/components/ui/Dialog';
import { usePref } from '@/core/prefs';
import { useNoteStyle } from '@/features/melody/note-style';
import type { SongTemplate } from '@/data/library-repository';

const TEMPLATES: Array<{ id: SongTemplate; label: string; hint: string }> = [
  { id: 'empty', label: 'Canción vacía', hint: 'Sin bloques: agregás lo que necesites.' },
  { id: 'lyrics', label: 'Con letra', hint: 'Empezás por lo que querés decir.' },
  { id: 'melody', label: 'Con melodía', hint: 'Empezás por lo que escuchás.' },
  { id: 'chords', label: 'Con acordes', hint: 'Empezás por una progresión.' },
  { id: 'structure', label: 'Con estructura inicial', hint: 'Verso 1 y Estribillo, cada uno con su letra y su melodía vinculadas.' },
];

/** The smallest possible form: a name, and (optionally) a BPM and a key. Nothing else is asked. */
export function NewSongDialog({
  onCreate,
  onClose,
}: {
  onCreate: (song: { title: string; bpm?: number; key?: KeySignature; template: SongTemplate }) => void;
  onClose: () => void;
}) {
  const [style] = useNoteStyle();
  const [preference] = usePref<number>('default-bpm', 96);
  const [title, setTitle] = useState('');
  const [bpm, setBpm] = useState(String(preference));
  const [key, setKey] = useState('');
  const [template, setTemplate] = useState<SongTemplate>('empty');
  return (
    <Dialog title="Nueva canción" size="md" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          const [tonic, mode] = key.split(':');
          onCreate({
            title: title.trim() || 'Nueva canción',
            bpm: bpm.trim() && Number.isFinite(Number(bpm)) ? clampBpm(Number(bpm)) : undefined,
            key: key ? { tonic, mode: mode as 'major' | 'minor' } : undefined,
            template,
          });
        }}
      >
        <label className="field">
          <span>Nombre</span>
          <input aria-label="Nombre de la canción" autoFocus value={title} placeholder="Tema 1 FT Goti" onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="field-pair">
          <label className="field">
            <span>BPM (opcional)</span>
            <input aria-label="BPM de la canción" type="number" min={30} max={280} inputMode="numeric" value={bpm} onChange={(event) => setBpm(event.target.value)} />
          </label>
          <label className="field">
            <span>Tonalidad (opcional)</span>
            <select aria-label="Tonalidad de la canción" value={key} onChange={(event) => setKey(event.target.value)}>
              <option value="">Sin definir</option>
              {allKeys().map((item) => (
                <option key={`${item.tonic}:${item.mode}`} value={`${item.tonic}:${item.mode}`}>
                  {keyTitle(item, style)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="template-choice">
          <legend>Cómo querés empezar</legend>
          {TEMPLATES.map((item) => (
            <label key={item.id} className="template-row">
              <input type="radio" name="song-template" checked={template === item.id} onChange={() => setTemplate(item.id)} />
              <span>
                <strong>{item.label}</strong>
                <small className="muted block">{item.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="muted small">Todo se puede cambiar después desde el encabezado de la canción. Nunca se impone una estructura.</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Crear canción
          </button>
        </div>
      </form>
    </Dialog>
  );
}
