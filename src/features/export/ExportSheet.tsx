import { forwardRef } from 'react';
import { ROLE_INFO, ROLES } from '@/core/harmony';
import { FretboardCanvas } from '@/features/fretboard/FretboardCanvas';
import { legendLabel, markersForAll, markersForPosition, rolesPresent } from '@/features/fretboard/map-markers';
import { resolvedView, visibleRange } from '@/features/fretboard/operations';
import { TabBlock } from '@/features/tablature/TabBlock';
import { formatNote } from '@/core/theory/pitch';
import { LyricsReading } from '@/features/lyrics/LyricsBlock';
import { useNoteStyle } from '@/features/melody/note-style';
import { intervalLabel, totalBeats } from '@/features/melody/operations';
import type { ExportItem, ExportSettings } from '@/features/export/export-plan';

export const SHEET_WIDTH = 1000;

/**
 * The page that gets exported, drawn from the real musical content, not from the screen. It has no
 * buttons, menus or selection, and its colors come from the theme chosen for the export. Everything
 * marked `data-export-unit` is something a PDF page may break before but never through.
 */
export const ExportSheet = forwardRef<HTMLDivElement, { title: string; items: ExportItem[]; settings: ExportSettings }>(
  function ExportSheet({ title, items, settings }, ref) {
    const [noteStyle] = useNoteStyle();
    const commentsOf = (item: ExportItem) =>
      settings.comments && item.comments?.length ? (
        <ul className="ex-comments" data-export-unit>
          {item.comments.map((comment) => (
            <li key={comment.id}>{comment.text}</li>
          ))}
        </ul>
      ) : null;
    return (
      <div
        ref={ref}
        className="export-sheet"
        data-theme={settings.theme}
        data-bg={settings.theme === 'dark' && settings.background === 'white' ? 'paper' : settings.background}
        style={{ width: SHEET_WIDTH }}
      >
        {settings.title && title.trim() && (
          <h1 className="ex-title" data-export-unit>
            {title}
          </h1>
        )}
        {items.map((item) => {
          if (item.kind === 'text' && item.text) {
            if (item.text.style === 'note' && !settings.notes) return null;
            return item.text.style === 'heading' ? (
              <h2 key={item.key} className="ex-heading" data-export-unit>
                {item.text.value}
              </h2>
            ) : (
              <p key={item.key} className="ex-note" data-export-unit>
                {item.text.value}
              </p>
            );
          }
          if (item.kind === 'melody' && item.melody) {
            const melody = item.melody;
            return (
              <section key={item.key} className="ex-item ex-melody" data-export-unit>
                {item.caption && <h3 className="ex-caption">{item.caption}</h3>}
                <div className="ex-notes">
                  {melody.events.map((event, index) => {
                    const before = melody.events.slice(0, index).reverse().find((other) => other.midi !== undefined);
                    return (
                      <span key={event.id} className={`ex-note-chip${event.type === 'rest' ? ' rest' : ''}`} style={{ ['--beats' as string]: event.beats }}>
                        <b>{event.type === 'rest' || event.midi === undefined ? 'silencio' : formatNote(event.midi, noteStyle, event.accidental ?? 'sharp')}</b>
                        {event.beats !== 1 && <small>{event.beats} pulsos</small>}
                        {event.lyric && <em>{event.lyric}</em>}
                        {before?.midi !== undefined && event.midi !== undefined && settings.notes && <i hidden>{intervalLabel(before.midi, event.midi)}</i>}
                      </span>
                    );
                  })}
                </div>
                <p className="muted small">{melody.events.filter((event) => event.type === 'note').length} notas · {totalBeats(melody)} pulsos</p>
                {settings.notes && melody.phrase && <p className="ex-phrase">{melody.phrase}</p>}
                {commentsOf(item)}
              </section>
            );
          }
          if (item.kind === 'lyrics' && item.lyrics) {
            return (
              <section key={item.key} className="ex-item ex-lyrics">
                {item.caption && <h3 className="ex-caption" data-export-unit>{item.caption}</h3>}
                <LyricsReading content={item.lyrics} />
                {commentsOf(item)}
              </section>
            );
          }
          if (item.kind === 'chords' && item.chords) {
            return (
              <section key={item.key} className="ex-item ex-chords" data-export-unit>
                {item.caption && <h3 className="ex-caption">{item.caption}</h3>}
                <div className="ex-notes">
                  {item.chords.items.map((chord) => (
                    <span key={chord.id} className="ex-note-chip chord" style={{ ['--beats' as string]: chord.beats }}>
                      <b>{chord.symbol}</b>
                    </span>
                  ))}
                </div>
                {commentsOf(item)}
              </section>
            );
          }
          if (item.kind === 'tablature' && item.tab) {
            return (
              <section key={item.key} className="ex-item ex-tab">
                {item.caption && (
                  <h3 className="ex-caption" data-export-unit>
                    {item.caption}
                  </h3>
                )}
                <TabBlock blockId={`export-${item.key}`} content={item.tab} readOnly onChange={() => undefined} />
              </section>
            );
          }
          if (item.kind === 'map' && item.map) {
            const { content, position, positionIndex, complete } = item.map;
            const view = resolvedView(content);
            const range = visibleRange(content);
            const options = { show: view.labels, emphasis: view.emphasis, extensions: view.extensions };
            const markers = complete
              ? markersForAll(content, options)
              : position
                ? markersForPosition(content, position, positionIndex, options)
                : [];
            const present = rolesPresent(content, view.extensions);
            return (
              <section key={item.key} className="ex-item" data-export-unit>
                {item.caption && <h3 className="ex-caption">{item.caption}</h3>}
                <FretboardCanvas
                  tuning={content.tuning}
                  latin={content.latin}
                  from={range.from}
                  to={range.to}
                  markers={markers}
                  label={item.caption || 'Mástil'}
                  maxCell={70}
                  minCell={30}
                />
                {settings.legend && view.legend && present.length > 0 && (
                  <ul className="harmony-legend static" aria-hidden="true">
                    {ROLES.filter((role) => present.includes(role)).map((role) => (
                      <li key={role} className="legend-item">
                        <i className={`legend-dot role-${role}`}>{legendLabel(content, role, view.extensions)}</i>
                        {ROLE_INFO[role].name}
                      </li>
                    ))}
                  </ul>
                )}
                {settings.notes && position?.comments && <p className="ex-note small">{position.comments}</p>}
              </section>
            );
          }
          return null;
        })}
      </div>
    );
  },
);
