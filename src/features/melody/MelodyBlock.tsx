import { useMemo, useRef, useState } from 'react';
import { melodyToSequence } from '@/audio/plan';
import { previewNote } from '@/audio/preview';
import { useBlockPlayer } from '@/audio/useBlockPlayer';
import type { MelodyContent, MelodyEvent } from '@/core/model';
import { formatNote, octaveOf, parseNote, pitchClassName } from '@/core/theory/pitch';
import { Icon } from '@/components/ui/Icon';
import { Menu, Popover } from '@/components/ui/Popover';
import { Segmented } from '@/components/ui/Segmented';
import { CommentButton, useComments } from '@/features/notebook/comments';
import { PlayerBar } from '@/features/notebook/PlayerBar';
import { useNoteStyle } from '@/features/melody/note-style';
import { PianoPicker } from '@/features/melody/PianoPicker';
import {
  assignSyllables, clampBeats, DURATIONS, duplicateEvents, insertEvents, intervalLabel, moveEvent, newId, noteCount, noteEvent,
  parseMelodyText, range, removeEvents, restEvent, reverseOrder, setBeats, setLyric, setPitch, shiftOctave, splitSyllables,
  toggleRest, totalBeats, transpose,
} from '@/features/melody/operations';

type Change = (update: (content: MelodyContent) => MelodyContent) => void;
/** Copy/paste inside the app: notes without ids (a pasted note is a new note). */
let clipboard: Array<Omit<MelodyEvent, 'id' | 'lyric'>> = [];

const split = (text: string) => {
  const match = /^(.*?)(-?\d+)$/.exec(text);
  return match ? { name: match[1], octave: match[2] } : { name: text, octave: '' };
};
const beatsLabel = (beats: number) => (beats === 0.5 ? '½ pulso' : beats === 1 ? '1 pulso' : `${beats} pulsos`);

export function MelodyBlock({
  blockId,
  content,
  onChange,
  readOnly = false,
  onActivate,
  onExportMidi,
}: {
  blockId: string;
  content: MelodyContent;
  onChange: Change;
  readOnly?: boolean;
  onActivate?: () => void;
  onExportMidi?: () => void;
}) {
  const [style, setStyle] = useNoteStyle();
  const sequence = useMemo(() => melodyToSequence(content), [content]);
  const player = useBlockPlayer({ owner: blockId, sequence, blockBpm: content.bpm, instrument: content.instrument });
  const comments = useComments();
  const [selection, setSelection] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<Array<{ token: string; reason: string }>>([]);
  const [keyboard, setKeyboard] = useState(false);
  const [showLyrics, setShowLyrics] = useState(Boolean(content.phrase) || content.events.some((event) => event.lyric));
  const [syllables, setSyllables] = useState('');
  const strip = useRef<HTMLDivElement>(null);

  const events = content.events;
  const selectedEvents = events.filter((event) => selection.includes(event.id));
  const last = selectedEvents.at(-1) ?? null;
  const insertIndex = last ? events.indexOf(last) + 1 : events.length;
  const spans = range(content);
  const hear = (midi: number) => {
    if (player.prefs.preview) void previewNote(midi, player.instrument);
  };

  function select(ids: string[], anchorId = ids[0] ?? null) {
    setSelection(ids);
    setAnchor(anchorId);
    const id = ids.at(-1);
    if (id) document.getElementById(`mel-${id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function add(newEvents: MelodyEvent[]) {
    if (!newEvents.length) return;
    const at = insertIndex;
    onChange((current) => insertEvents(current, newEvents, at));
    select(newEvents.map((event) => event.id));
    const firstNote = newEvents.find((event) => event.midi !== undefined);
    if (firstNote?.midi !== undefined) hear(firstNote.midi);
  }
  const referenceMidi = () => last?.midi ?? [...events].reverse().find((event) => event.midi !== undefined)?.midi ?? 60;


  function submitText() {
    if (!text.trim()) return;
    const parsed = parseMelodyText(text);
    setErrors(parsed.errors);
    if (parsed.errors.length || !parsed.events.length) return;
    add(parsed.events);
    setText('');
  }

  function extend(toId: string) {
    const from = events.findIndex((event) => event.id === (anchor ?? toId));
    const to = events.findIndex((event) => event.id === toId);
    if (from < 0 || to < 0) return;
    const [start, end] = from < to ? [from, to] : [to, from];
    setSelection(events.slice(start, end + 1).map((event) => event.id));
  }
  function move(delta: -1 | 1, extendSelection: boolean) {
    if (!events.length) return;
    const index = last ? events.indexOf(last) + delta : delta > 0 ? 0 : events.length - 1;
    const target = events[Math.max(0, Math.min(events.length - 1, index))];
    if (extendSelection) {
      if (!anchor) setAnchor(target.id);
      extend(target.id);
    } else select([target.id]);
    document.getElementById(`mel-${target.id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function nudge(semitones: number) {
    if (readOnly || !selection.length) return;
    onChange((current) => transpose(current, semitones, selection));
    const midi = (last?.midi ?? 60) + semitones;
    if (last?.midi !== undefined) hear(midi);
  }
  function remove() {
    if (readOnly || !selection.length) return;
    const index = Math.min(...selection.map((id) => events.findIndex((event) => event.id === id)));
    onChange((current) => removeEvents(current, selection));
    const rest = events.filter((event) => !selection.includes(event.id));
    const next = rest[Math.min(index, rest.length - 1)];
    select(next ? [next.id] : []);
  }
  function duplicate() {
    if (readOnly || !selection.length) return;
    const result = duplicateEvents(content, selection);
    onChange(() => result.melody);
    select(result.ids);
  }
  function copy() {
    clipboard = selectedEvents.map(({ id: _id, lyric: _lyric, ...rest }) => {
      void _id; void _lyric;
      return rest;
    });
  }
  function paste() {
    if (readOnly || !clipboard.length) return;
    add(clipboard.map((event) => ({ ...event, id: newId() })));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (modifier && key.toLowerCase() === 'c') { copy(); return; }
    if (modifier && key.toLowerCase() === 'v' && !readOnly) { event.preventDefault(); paste(); return; }
    if (modifier && key.toLowerCase() === 'd' && !readOnly) { event.preventDefault(); duplicate(); return; }
    if (modifier || event.altKey) return;
    if (key === 'ArrowRight') move(1, event.shiftKey);
    else if (key === 'ArrowLeft') move(-1, event.shiftKey);
    else if (key === 'Home') select(events[0] ? [events[0].id] : []);
    else if (key === 'End') select(events.length ? [events[events.length - 1].id] : []);
    else if (key === 'Escape') select([]);
    else if (key === ' ') { event.preventDefault(); if (player.state === 'idle' && last) void player.play(sequence.events.find((item) => item.id === last.id)?.start ?? 0); else player.toggle(); }
    else if (readOnly) return;
    else if (key === 'ArrowUp') nudge(event.shiftKey ? 12 : 1);
    else if (key === 'ArrowDown') nudge(event.shiftKey ? -12 : -1);
    else if (key === 'Delete' || key === 'Backspace') remove();
    else if (/^[1-4]$/.test(key) && selection.length) onChange((current) => setBeats(current, selection, DURATIONS[Number(key) - 1].beats));
    else if (/^[a-gA-G]$/.test(key)) {
      const ref = referenceMidi();
      const letter = parseNote(`${key.toUpperCase()}${octaveOf(ref)}`);
      if (!letter) return;
      // Pick the octave that keeps the new note closest to the previous one.
      const candidates = [letter.midi - 12, letter.midi, letter.midi + 12];
      const midi = candidates.reduce((best, item) => (Math.abs(item - ref) < Math.abs(best - ref) ? item : best));
      add([noteEvent(midi, last?.beats ?? 1)]);
    } else if (key === 'r' || key === 'R') add([restEvent(last?.beats ?? 1)]);
    else return;
    event.preventDefault();
  }

  const onlyOne = selection.length === 1 ? last : null;
  const previousNote = onlyOne ? events.slice(0, events.indexOf(onlyOne)).reverse().find((event) => event.midi !== undefined) : null;
  const name = (event: MelodyEvent) => (event.type === 'rest' || event.midi === undefined ? null : formatNote(event.midi, style, event.accidental ?? 'sharp'));
  const durationValue = selectedEvents.length && selectedEvents.every((event) => event.beats === selectedEvents[0].beats) ? String(selectedEvents[0].beats) : '';
  const lowName = spans ? formatNote(spans.low, style) : '';
  const highName = spans ? formatNote(spans.high, style) : '';

  return (
    <div className="melody-block" onFocusCapture={onActivate} onPointerDownCapture={onActivate}>
      <div className="player-row nb-chrome">
        <PlayerBar
          player={player}
          label="melodía"
          disabled={noteCount(content) === 0}
          emptyHint="Escribí alguna nota para poder escucharla"
          onBpm={readOnly ? undefined : (bpm) => onChange((current) => ({ ...current, bpm: Math.max(30, Math.min(280, Math.round(bpm))) }))}
          onInstrument={readOnly ? undefined : (instrument) => onChange((current) => ({ ...current, instrument }))}
        />
        {!readOnly && (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!last}
              onClick={() => void player.play(sequence.events.find((item) => item.id === last?.id)?.start ?? 0)}
            >
              Desde la selección
            </button>
            <Menu
              label="Herramientas de la melodía"
              align="end"
              triggerClassName="btn btn-ghost"
              trigger={<>Herramientas <Icon name="chevron-down" size={12} /></>}
              items={[
                { label: selection.length ? 'Subir medio tono' : 'Subir toda la melodía medio tono', onSelect: () => onChange((c) => transpose(c, 1, selection.length ? selection : undefined)) },
                { label: selection.length ? 'Bajar medio tono' : 'Bajar toda la melodía medio tono', onSelect: () => onChange((c) => transpose(c, -1, selection.length ? selection : undefined)) },
                { label: selection.length ? 'Subir una octava' : 'Subir toda la melodía una octava', onSelect: () => onChange((c) => shiftOctave(c, 1, selection.length ? selection : undefined)) },
                { label: selection.length ? 'Bajar una octava' : 'Bajar toda la melodía una octava', onSelect: () => onChange((c) => shiftOctave(c, -1, selection.length ? selection : undefined)) },
                { separator: true },
                { label: 'Invertir el orden de las notas', onSelect: () => onChange(reverseOrder) },
                { label: 'Repetir la frase', description: 'Agrega una copia al final', onSelect: () => onChange((c) => duplicateEvents(c, c.events.map((event) => event.id)).melody) },
                { separator: true },
                { label: 'Nombres: Do Re Mi', checked: style === 'latin', onSelect: () => setStyle('latin') },
                { label: 'Nombres: C D E', checked: style === 'english', onSelect: () => setStyle('english') },
                ...(onExportMidi ? [{ separator: true as const }, { label: 'Exportar como archivo MIDI', icon: 'export' as const, disabled: noteCount(content) === 0, onSelect: onExportMidi }] : []),
              ]}
            />
          </>
        )}
      </div>

      {!readOnly && (
        <div className="melody-entry nb-chrome">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitText();
            }}
          >
            <label className="visually-hidden" htmlFor={`mel-text-${blockId}`}>Escribir notas</label>
            <input
              id={`mel-text-${blockId}`}
              aria-label="Escribir notas"
              className="melody-text"
              placeholder="Escribí notas: Do4 Re4 Mi4:2 r Sol4   (o C4 D4 E4)"
              value={text}
              aria-invalid={errors.length > 0}
              aria-describedby={errors.length ? `mel-err-${blockId}` : undefined}
              onChange={(event) => {
                setText(event.target.value);
                if (errors.length) setErrors([]);
              }}
            />
            <button type="submit" className="btn" disabled={!text.trim()}>
              <Icon name="plus" size={14} /> Agregar
            </button>
            <button type="button" className="btn btn-ghost" aria-pressed={keyboard} onClick={() => setKeyboard((value) => !value)}>
              <Icon name="keyboard" size={14} /> Teclado
            </button>
          </form>
          {errors.length > 0 && (
            <ul id={`mel-err-${blockId}`} className="melody-errors" role="alert">
              {errors.map((error) => (
                <li key={error.token}><strong>{error.token}</strong>: {error.reason}</li>
              ))}
              <li className="muted">No se agregó nada: tu melodía sigue igual.</li>
            </ul>
          )}
          {keyboard && (
            <PianoPicker
              style={style}
              selected={last?.midi}
              onPick={(midi) => add([noteEvent(midi, last?.beats ?? 1)])}
            />
          )}
        </div>
      )}

      <div
        ref={strip}
        className="melody-strip"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Notas de la melodía"
        aria-activedescendant={last ? `mel-${last.id}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {events.length === 0 && (
          <p className="melody-empty">{readOnly ? 'Esta melodía no tiene notas.' : 'Todavía no hay notas. Escribí arriba, usá el teclado o apretá una letra (C, D, E…) acá.'}</p>
        )}
        {events.map((event) => {
          const label = name(event);
          const parts = label ? split(label) : null;
          const selected = selection.includes(event.id);
          const playing = player.activeId === event.id;
          const commented = comments.all.some((comment) => comment.blockId === blockId && comment.eventId === event.id);
          return (
            <div
              key={event.id}
              id={`mel-${event.id}`}
              role="option"
              aria-selected={selected}
              aria-label={`${label ?? 'Silencio'}, ${beatsLabel(event.beats)}${event.lyric ? `, sílaba ${event.lyric}` : ''}${commented ? ', con comentario' : ''}`}
              className={`mel-chip${event.type === 'rest' ? ' rest' : ''}${selected ? ' sel' : ''}${playing ? ' playing' : ''}`}
              style={{ ['--beats' as string]: event.beats }}
              onClick={(click) => {
                strip.current?.focus();
                if (click.shiftKey) extend(event.id);
                else if (click.ctrlKey || click.metaKey) setSelection((current) => (current.includes(event.id) ? current.filter((id) => id !== event.id) : [...current, event.id]));
                else {
                  select([event.id]);
                  if (event.midi !== undefined) hear(event.midi);
                }
              }}
            >
              <span className="mel-name">
                {parts ? (<><b>{parts.name}</b><sub>{parts.octave}</sub></>) : <i>silencio</i>}
              </span>
              <span className="mel-len" aria-hidden="true">{event.beats === 1 ? '' : beatsLabel(event.beats)}</span>
              {event.lyric && <span className="mel-lyric">{event.lyric}</span>}
              {commented && <span className="mel-dot" aria-hidden="true" />}
            </div>
          );
        })}
      </div>

      <div className="melody-info muted small" aria-live="polite">
        {events.length > 0 && (
          <span>
            {noteCount(content)} {noteCount(content) === 1 ? 'nota' : 'notas'} · {totalBeats(content)} pulsos
            {spans && ` · rango ${lowName}–${highName}${spans.span ? ` (${spans.span} semitonos)` : ''}`}
          </span>
        )}
        {onlyOne?.midi !== undefined && previousNote?.midi !== undefined && (
          <span> · desde la nota anterior: {intervalLabel(previousNote.midi, onlyOne.midi)}</span>
        )}
      </div>

      {!readOnly && selection.length > 0 && (
        <div className="melody-tools nb-chrome" role="toolbar" aria-label="Edición de la nota seleccionada">
          <span className="tool-group" role="group" aria-label="Altura">
            <button type="button" className="icon-btn" aria-label="Bajar medio tono" onClick={() => nudge(-1)}><Icon name="arrow-down" size={14} /></button>
            <button type="button" className="icon-btn" aria-label="Subir medio tono" onClick={() => nudge(1)}><Icon name="arrow-up" size={14} /></button>
            <button type="button" className="btn btn-ghost" aria-label="Bajar una octava" onClick={() => nudge(-12)}>8ª ↓</button>
            <button type="button" className="btn btn-ghost" aria-label="Subir una octava" onClick={() => nudge(12)}>8ª ↑</button>
            {onlyOne?.midi !== undefined && (
              <select
                aria-label="Nota"
                value={onlyOne.midi % 12}
                onChange={(event) => onChange((current) => setPitch(current, onlyOne.id, (octaveOf(onlyOne.midi!) + 1) * 12 + Number(event.target.value)))}
              >
                {Array.from({ length: 12 }, (_, pc) => (
                  <option key={pc} value={pc}>{pitchClassName(pc, style)}</option>
                ))}
              </select>
            )}
            {onlyOne?.midi !== undefined && [1, 3, 6, 8, 10].includes(onlyOne.midi % 12) && (
              <button
                type="button"
                className="btn btn-ghost"
                title="Escribir esta nota con sostenido o con bemol (suena igual)"
                onClick={() => onChange((current) => setPitch(current, onlyOne.id, onlyOne.midi!, onlyOne.accidental === 'flat' ? 'sharp' : 'flat'))}
              >
                {onlyOne.accidental === 'flat' ? '♭ → ♯' : '♯ → ♭'}
              </button>
            )}
          </span>
          <span className="tool-group">
            <Segmented<string>
              label="Duración"
              value={durationValue}
              onChange={(value) => onChange((current) => setBeats(current, selection, Number(value)))}
              options={DURATIONS.map((item) => ({ value: String(item.beats), label: item.label, title: item.hint }))}
            />
            <Popover label="Otra duración" triggerClassName="btn btn-ghost" trigger={<>Pulsos</>}>
              {() => (
                <label className="field inline">
                  <span>Pulsos</span>
                  <input
                    type="number"
                    aria-label="Duración en pulsos"
                    min={0.25}
                    max={16}
                    step={0.25}
                    value={selectedEvents[0]?.beats ?? 1}
                    onChange={(event) => onChange((current) => setBeats(current, selection, clampBeats(Number(event.target.value) || 1)))}
                  />
                </label>
              )}
            </Popover>
          </span>
          <span className="tool-group">
            {onlyOne && (
              <button type="button" className="btn btn-ghost" onClick={() => onChange((current) => toggleRest(current, onlyOne.id))}>
                {onlyOne.type === 'rest' ? 'Hacer nota' : 'Hacer silencio'}
              </button>
            )}
            {last?.midi !== undefined && (
              <button type="button" className="btn btn-ghost" onClick={() => void previewNote(last.midi!, player.instrument)}>Escuchar nota</button>
            )}
            <button type="button" className="icon-btn" aria-label="Mover a la izquierda" disabled={!onlyOne} onClick={() => onlyOne && onChange((current) => moveEvent(current, onlyOne.id, -1))}><Icon name="chevron-left" size={14} /></button>
            <button type="button" className="icon-btn" aria-label="Mover a la derecha" disabled={!onlyOne} onClick={() => onlyOne && onChange((current) => moveEvent(current, onlyOne.id, 1))}><Icon name="chevron-right" size={14} /></button>
            <button type="button" className="icon-btn" aria-label="Duplicar nota" onClick={duplicate}><Icon name="copy" size={14} /></button>
            {onlyOne && <CommentButton blockId={blockId} eventId={onlyOne.id} label="la nota seleccionada" forceVisible />}
            <button type="button" className="icon-btn danger" aria-label="Eliminar nota" onClick={remove}><Icon name="trash" size={14} /></button>
          </span>
          {onlyOne && showLyrics && (
            <label className="field inline compact">
              <span>Sílaba</span>
              <input
                aria-label="Sílaba de esta nota"
                value={onlyOne.lyric ?? ''}
                placeholder="—"
                onChange={(event) => onChange((current) => setLyric(current, onlyOne.id, event.target.value))}
              />
            </label>
          )}
        </div>
      )}

      {(showLyrics || readOnly) && (content.phrase || !readOnly) && (
        <div className="melody-lyrics">
          {readOnly ? (
            <p className="melody-phrase">{content.phrase}</p>
          ) : (
            <>
              <label>
                <span className="muted small">Frase de letra para esta melodía</span>
                <textarea
                  aria-label="Frase de letra de la melodía"
                  rows={2}
                  placeholder="Hoy vuelvo a casa…"
                  value={content.phrase ?? ''}
                  onChange={(event) => onChange((current) => ({ ...current, phrase: event.target.value }))}
                />
              </label>
              <div className="syllables nb-chrome">
                <input
                  aria-label="Sílabas para repartir"
                  placeholder="Sílabas separadas por espacios: Hoy vuel-vo a"
                  value={syllables}
                  onChange={(event) => setSyllables(event.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={!syllables.trim() || noteCount(content) === 0}
                  title="Escribe una sílaba en cada nota, a partir de la seleccionada (o la primera). Las notas sin sílaba quedan sin letra."
                  onClick={() => {
                    onChange((current) => assignSyllables(current, splitSyllables(syllables), last?.id));
                    setSyllables('');
                  }}
                >
                  Repartir sobre las notas
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {!readOnly && (
        <button type="button" className="btn btn-link lyric-toggle nb-chrome" aria-expanded={showLyrics} onClick={() => setShowLyrics((value) => !value)}>
          {showLyrics ? 'Ocultar letra' : 'Agregar letra a esta melodía'}
        </button>
      )}
    </div>
  );
}
