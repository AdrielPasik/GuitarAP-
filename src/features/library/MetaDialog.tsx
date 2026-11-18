import { useState } from 'react';
import type { CoverStyle, MusicalDocument, SongMeta } from '@/core/model';
import { setMeta, toNotebook } from '@/core/notebook';
import { Dialog } from '@/components/ui/Dialog';
import { Cover, COVER_STYLES } from '@/features/library/Cover';
import { autoStyle, hueOf } from '@/features/library/folder-entries';

export const canEditMeta = (doc: MusicalDocument) => (doc.content as { kind?: string }).kind === 'notebook';

/**
 * «Ficha»: optional facts about a song (yours or someone else's). Nothing is required and nothing is guessed.
 * Only the `meta` of the notebook changes: blocks, notes, lyrics and history stay exactly as they are.
 */
export function MetaDialog({ doc, onClose, onSave }: { doc: MusicalDocument; onClose: () => void; onSave: (next: MusicalDocument) => Promise<void> }) {
  const notebook = toNotebook(doc);
  const meta = notebook.meta ?? {};
  const [artist, setArtist] = useState(meta.artist ?? '');
  const [album, setAlbum] = useState(meta.album ?? '');
  const [year, setYear] = useState(meta.year ? String(meta.year) : '');
  const [tags, setTags] = useState((meta.tags ?? []).join(', '));
  const [status, setStatus] = useState<SongMeta['status'] | ''>(meta.status ?? '');
  const [notes, setNotes] = useState(meta.notes ?? '');
  const [style, setStyle] = useState<CoverStyle | ''>(meta.cover?.style ?? '');
  const [hue, setHue] = useState(meta.cover?.hue ?? hueOf(doc.title || doc.id));
  const shownStyle = style || autoStyle(doc.id);
  const yearNumber = Number(year);
  const yearValid = !year || (Number.isInteger(yearNumber) && yearNumber >= 1000 && yearNumber <= 2200);

  return (
    <Dialog title={`Ficha de «${doc.title || 'Sin título'}»`} onClose={onClose} size="md">
      <form
        className="stack meta-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!yearValid) return;
          const content = setMeta(notebook, {
            artist: artist.trim() || undefined,
            album: album.trim() || undefined,
            year: year ? yearNumber : undefined,
            tags: tags.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean).slice(0, 12).length ? tags.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean).slice(0, 12) : undefined,
            status: status || undefined,
            notes: notes.trim() || undefined,
            cover: style ? { style, hue } : undefined,
          });
          void onSave({ ...doc, content });
        }}
      >
        <p className="muted small">Todo es opcional. Sirve igual para una canción tuya o para una que estás estudiando de otro artista.</p>
        <div className="meta-grid">
          <label className="field"><span>Artista</span><input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Vacío si es tuya" maxLength={120} /></label>
          <label className="field"><span>Álbum</span><input value={album} onChange={(event) => setAlbum(event.target.value)} maxLength={120} /></label>
          <label className="field"><span>Año</span><input inputMode="numeric" value={year} aria-invalid={!yearValid} onChange={(event) => setYear(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))} /></label>
          <label className="field"><span>Estado</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as SongMeta['status'] | '')}>
              <option value="">Sin estado</option><option value="idea">Idea</option><option value="progress">En proceso</option><option value="done">Terminada</option>
            </select>
          </label>
        </div>
        <label className="field"><span>Etiquetas (separadas por coma)</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="ensayo, acústica" /></label>
        <label className="field"><span>Notas personales</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Qué practicar, en qué fijarte…" /></label>
        <fieldset className="cover-picker">
          <legend>Portada</legend>
          <div className="cover-options" role="radiogroup" aria-label="Diseño de portada">
            <label className={`cover-option${style === '' ? ' on' : ''}`}>
              <input type="radio" name="cover" checked={style === ''} onChange={() => setStyle('')} />
              <Cover title={doc.title} style={autoStyle(doc.id)} hue={hueOf(doc.title || doc.id)} size="sm" />
              <span>Automática</span>
            </label>
            {COVER_STYLES.map((item) => (
              <label key={item.id} className={`cover-option${style === item.id ? ' on' : ''}`}>
                <input type="radio" name="cover" checked={style === item.id} onChange={() => setStyle(item.id)} />
                <Cover title={doc.title} style={item.id} hue={hue} size="sm" />
                <span>{item.name}</span>
              </label>
            ))}
          </div>
          {style && (
            <label className="field inline"><span>Color</span><input type="range" min={0} max={359} value={hue} aria-label="Color de la portada" onChange={(event) => setHue(Number(event.target.value))} /></label>
          )}
          <div className="cover-preview"><Cover title={doc.title} style={shownStyle} hue={style ? hue : hueOf(doc.title || doc.id)} size="lg" /></div>
          <p className="muted small">Portadas originales dibujadas por GuitarAP. No se descarga arte de discos. Subir imágenes propias queda para una próxima versión (necesita almacenamiento seguro en la nube).</p>
        </fieldset>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={!yearValid}>Guardar ficha</button>
        </div>
      </form>
    </Dialog>
  );
}
