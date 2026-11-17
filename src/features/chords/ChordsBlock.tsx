import { useMemo, useState } from 'react';
import { chordsToSequence } from '@/audio/plan';
import { previewNote } from '@/audio/preview';
import { useBlockPlayer } from '@/audio/useBlockPlayer';
import type { ChordItem, ChordsContent } from '@/core/model';
import { chordSymbol, parseChord, transposeChord } from '@/core/theory/chords';
import { diatonicChords, isDiatonic, keyLabel, romanOf, transposeKey } from '@/core/theory/keys';
import { Icon } from '@/components/ui/Icon';
import { Menu, Popover } from '@/components/ui/Popover';
import { Segmented } from '@/components/ui/Segmented';
import { CommentButton, useComments } from '@/features/notebook/comments';
import { useNotebookInfo } from '@/features/notebook/notebook-context';
import { PlayerBar } from '@/features/notebook/PlayerBar';
import { chordVoicing } from '@/audio/plan';

type Change = (update: (content: ChordsContent) => ChordsContent) => void;

/** "C - G - Am - F", "C G Am F" or "C | G | Am7 | F:4" (length in beats after a colon). */
export function parseProgression(text: string, beats = 2) {
  const tokens = text.replace(/[—–|,;]/g, ' ').replace(/(^|\s)-(?=\s|$)/g, ' ').split(/\s+/).filter(Boolean);
  const items: ChordItem[] = [];
  const errors: Array<{ token: string; reason: string }> = [];
  for (const token of tokens) {
    const [symbol, length] = token.split(':');
    const chord = parseChord(symbol);
    if (!chord) {
      errors.push({
        token,
        reason: /\d$/.test(symbol) && /^[A-Ga-g]/.test(symbol) && /^[A-G][#b]?\d$/.test(symbol)
          ? 'Eso es una nota con octava. Un acorde se escribe C, Am, G7, Cmaj7…'
          : 'No es un acorde que reconozca. Probá con C, Am, G7, Dm7, Cmaj7 o F#m7b5.',
      });
      continue;
    }
    const value = length === undefined ? beats : Number(length);
    if (!Number.isFinite(value) || value <= 0 || value > 16) {
      errors.push({ token, reason: 'La duración debe ser un número de pulsos entre 0.25 y 16.' });
      continue;
    }
    items.push({ id: crypto.randomUUID(), symbol: chordSymbol(chord), beats: value });
  }
  return { items, errors };
}

export function ChordsBlock({
  blockId,
  content,
  onChange,
  readOnly = false,
  onActivate,
}: {
  blockId: string;
  content: ChordsContent;
  onChange: Change;
  readOnly?: boolean;
  onActivate?: () => void;
}) {
  const { key, openTools } = useNotebookInfo();
  const comments = useComments();
  const sequence = useMemo(() => chordsToSequence(content), [content]);
  const player = useBlockPlayer({ owner: blockId, sequence, blockBpm: content.bpm, instrument: content.instrument });
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<Array<{ token: string; reason: string }>>([]);
  const [shift, setShift] = useState(2);
  const items = content.items;
  const current = items.find((item) => item.id === selected) ?? null;

  function submit() {
    if (!text.trim()) return;
    const parsed = parseProgression(text);
    setErrors(parsed.errors);
    if (parsed.errors.length || !parsed.items.length) return;
    const at = current ? items.indexOf(current) + 1 : items.length;
    onChange((state) => ({ ...state, items: [...state.items.slice(0, at), ...parsed.items, ...state.items.slice(at)] }));
    setSelected(parsed.items.at(-1)?.id ?? null);
    setText('');
  }
  function patch(id: string, change: Partial<ChordItem>) {
    onChange((state) => ({ ...state, items: state.items.map((item) => (item.id === id ? { ...item, ...change } : item)) }));
  }
  function move(id: string, offset: -1 | 1) {
    onChange((state) => {
      const index = state.items.findIndex((item) => item.id === id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= state.items.length) return state;
      const next = [...state.items];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...state, items: next };
    });
  }
  function transposeAll(semitones: number) {
    const target = key ? transposeKey(key, semitones) : null;
    const flats = target ? ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'].includes(target.tonic) || target.tonic.includes('b') : undefined;
    onChange((state) => ({ ...state, items: state.items.map((item) => ({ ...item, symbol: transposeChord(item.symbol, semitones, flats) })) }));
  }
  const hearChord = (symbol: string) => {
    const voicing = chordVoicing(symbol);
    voicing.forEach((midi) => void previewNote(midi, player.instrument, 0.9));
  };
  const diatonic = key ? new Set(diatonicChords(key).map((chord) => chord.symbol)) : null;

  return (
    <div className="chords-block" onFocusCapture={onActivate} onPointerDownCapture={onActivate}>
      <div className="player-row nb-chrome">
        <PlayerBar
          player={player}
          label="progresión"
          disabled={items.length === 0}
          emptyHint="Agregá algún acorde para poder escucharlo"
          onBpm={readOnly ? undefined : (bpm) => onChange((state) => ({ ...state, bpm: Math.max(30, Math.min(280, Math.round(bpm))) }))}
          onInstrument={readOnly ? undefined : (instrument) => onChange((state) => ({ ...state, instrument }))}
        />
        {!readOnly && (
          <>
            <Popover label="Transponer la progresión" triggerClassName="btn btn-ghost" trigger={<>Transponer <Icon name="chevron-down" size={12} /></>}>
              {(close) => (
                <div className="pop-stack">
                  <label className="field">
                    <span>Mover todos los acordes</span>
                    <select aria-label="Semitonos a transponer" value={shift} onChange={(event) => setShift(Number(event.target.value))}>
                      {Array.from({ length: 23 }, (_, index) => index - 11).filter(Boolean).map((value) => (
                        <option key={value} value={value}>{value > 0 ? `+${value}` : value} semitonos</option>
                      ))}
                    </select>
                  </label>
                  <p className="muted small">Es una acción explícita: solo cambia esta progresión, no la tonalidad del cuaderno ni otros bloques. Podés deshacerla.</p>
                  <button type="button" className="btn btn-primary" onClick={() => { transposeAll(shift); close(); }}>Transponer</button>
                </div>
              )}
            </Popover>
            {openTools && (
              <button type="button" className="btn btn-ghost" onClick={() => openTools(current ? { chord: current.symbol } : undefined)}>
                <Icon name="circle" size={14} /> Explorar armonía
              </button>
            )}
          </>
        )}
      </div>

      {!readOnly && (
        <div className="melody-entry nb-chrome">
          <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <input
              aria-label="Escribir acordes"
              className="melody-text"
              placeholder="Escribí acordes: C G Am F   (o C - G - Am7 - F:4)"
              value={text}
              aria-invalid={errors.length > 0}
              onChange={(event) => { setText(event.target.value); if (errors.length) setErrors([]); }}
            />
            <button type="submit" className="btn" disabled={!text.trim()}><Icon name="plus" size={14} /> Agregar</button>
          </form>
          {errors.length > 0 && (
            <ul className="melody-errors" role="alert">
              {errors.map((error) => (<li key={error.token}><strong>{error.token}</strong>: {error.reason}</li>))}
              <li className="muted">No se agregó nada: tu progresión sigue igual.</li>
            </ul>
          )}
        </div>
      )}

      <div className="chord-strip" role="list" aria-label="Acordes de la progresión">
        {items.length === 0 && <p className="melody-empty">{readOnly ? 'Esta progresión no tiene acordes.' : 'Todavía no hay acordes. Escribí C G Am F arriba y apretá Agregar.'}</p>}
        {items.map((item) => {
          const chord = parseChord(item.symbol);
          const roman = key && chord ? romanOf(item.symbol, key) : null;
          const outside = key && chord ? !isDiatonic(chord, key) : false;
          const commented = comments.all.some((comment) => comment.blockId === blockId && comment.eventId === item.id);
          return (
            <div
              role="listitem"
              key={item.id}
              className={`chord-chip${selected === item.id ? ' sel' : ''}${player.activeId === item.id ? ' playing' : ''}${!chord ? ' invalid' : ''}`}
              style={{ ['--beats' as string]: item.beats }}
            >
              <button
                type="button"
                className="chord-btn"
                aria-label={`Acorde ${item.symbol}, ${item.beats} pulsos${roman ? `, grado ${roman}` : outside ? ', fuera de la tonalidad' : ''}${commented ? ', con comentario' : ''}`}
                aria-pressed={selected === item.id}
                onClick={() => {
                  setSelected(selected === item.id ? null : item.id);
                  if (player.prefs.preview) hearChord(item.symbol);
                }}
              >
                <b>{item.symbol}</b>
                {key && (roman ? <small>{roman}</small> : outside ? <small title={`No es diatónico en ${keyLabel(key)}`}>fuera</small> : null)}
                {commented && <span className="mel-dot" aria-hidden="true" />}
              </button>
            </div>
          );
        })}
      </div>
      {key && items.length > 0 && diatonic && (
        <p className="muted small">Grados en {keyLabel(key)}. «fuera» marca un acorde con notas ajenas a la tonalidad; es solo información, nada se corrige.</p>
      )}

      {!readOnly && current && (
        <div className="melody-tools nb-chrome" role="toolbar" aria-label="Edición del acorde seleccionado">
          <label className="field inline compact">
            <span>Símbolo</span>
            <input
              aria-label="Símbolo del acorde"
              key={current.id}
              defaultValue={current.symbol}
              onBlur={(event) => {
                const chord = parseChord(event.target.value);
                if (chord) patch(current.id, { symbol: chordSymbol(chord) });
                else event.target.value = current.symbol;
              }}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            />
          </label>
          <Segmented<string>
            label="Duración del acorde"
            value={String(current.beats)}
            onChange={(value) => patch(current.id, { beats: Number(value) })}
            options={[1, 2, 4].map((beats) => ({ value: String(beats), label: `${beats} ${beats === 1 ? 'pulso' : 'pulsos'}` }))}
          />
          <button type="button" className="btn btn-ghost" onClick={() => hearChord(current.symbol)}>Escuchar</button>
          <button type="button" className="icon-btn" aria-label="Mover acorde a la izquierda" onClick={() => move(current.id, -1)}><Icon name="chevron-left" size={14} /></button>
          <button type="button" className="icon-btn" aria-label="Mover acorde a la derecha" onClick={() => move(current.id, 1)}><Icon name="chevron-right" size={14} /></button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Duplicar acorde"
            onClick={() => onChange((state) => {
              const index = state.items.findIndex((item) => item.id === current.id);
              const copy = { ...current, id: crypto.randomUUID() };
              return { ...state, items: [...state.items.slice(0, index + 1), copy, ...state.items.slice(index + 1)] };
            })}
          ><Icon name="copy" size={14} /></button>
          <CommentButton blockId={blockId} eventId={current.id} label={`el acorde ${current.symbol}`} forceVisible />
          <button
            type="button"
            className="icon-btn danger"
            aria-label="Eliminar acorde"
            onClick={() => {
              onChange((state) => ({ ...state, items: state.items.filter((item) => item.id !== current.id) }));
              setSelected(null);
            }}
          ><Icon name="trash" size={14} /></button>
          <Menu
            label="Más sobre el acorde"
            align="end"
            triggerClassName="icon-btn"
            trigger={<Icon name="more" />}
            items={[{ label: 'Ver sus notas en Explorar armonía', icon: 'circle', disabled: !openTools, onSelect: () => openTools?.({ chord: current.symbol }) }]}
          />
        </div>
      )}
    </div>
  );
}
