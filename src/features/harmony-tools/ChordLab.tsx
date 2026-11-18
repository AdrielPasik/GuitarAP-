import { useEffect, useState } from 'react';
import { transport, useTransport } from '@/audio/engine';
import type { PlayEvent } from '@/audio/types';
import { useSoundPrefs } from '@/audio/useBlockPlayer';
import { chordSymbol, chordTones, parseChord, prettyRoot, QUALITIES, QUALITY_GROUPS, type Chord } from '@/core/theory/chords';
import { tonicName } from '@/core/theory/keys';
import { pitchClassName } from '@/core/theory/pitch';
import {
  chordMap, FOUR_STRING_SETS, generateVoicings, INVERSION_NAMES, shapeLabel, stringSetVoicings, TRIAD_STRING_SETS,
  type Inversion, type Voicing,
} from '@/core/theory/voicings';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { FretboardCanvas, type Marker } from '@/features/fretboard/FretboardCanvas';
import { ChordDiagram } from '@/features/harmony-tools/ChordDiagram';

const OWNER = 'harmony-lab';
type Style = 'latin' | 'english';
export type SaveVoicing = (title: string, rootPc: number, notes: Array<{ string: number; fret: number; root: boolean }>) => void;

const ROLE_NAMES = { root: 'tónica', third: 'tercera', fifth: 'quinta', seventh: 'séptima', other: 'tensión' } as const;
const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Plays one voicing: together, or strummed from the lowest string up (the order the shape defines). Never saves anything. */
export function useVoicingPlayer(bpm: number) {
  const snapshot = useTransport();
  const prefs = useSoundPrefs();
  const [playingId, setPlayingId] = useState<string | null>(null);
  useEffect(() => () => {
    if (transport.snapshot().owner === OWNER) transport.stop();
  }, []);
  const playing = snapshot.owner === OWNER && snapshot.state === 'playing';
  return {
    playingId: playing ? playingId : null,
    play: (voicing: Voicing, strum: boolean) => {
      const step = strum ? 0.12 : 0;
      const events: PlayEvent[] = voicing.notes.map((note, index) => ({ id: `${voicing.id}:${index}`, start: index * step, beats: 3 - index * step, midis: [note.midi] }));
      setPlayingId(voicing.id);
      void transport.play({ owner: OWNER, sequence: { events, totalBeats: 3 }, bpm, instrument: prefs.instrumentFor('chords') });
    },
    stop: () => transport.stop(),
  };
}

function markersOf(notes: Array<{ string: number; fret: number; name: string; degree: string; role: Marker['role'] | 'other' }>, style: Style): Marker[] {
  return notes.map((note) => ({
    string: note.string - 1,
    fret: note.fret,
    label: tonicName(note.name.replace('♯', '#').replace('♭', 'b'), style),
    sub: note.degree,
    tone: note.role === 'root' ? 'root' : 'note',
    role: note.role === 'other' ? undefined : note.role,
  }));
}

/** Voicing search is pure: results are kept by their inputs so re-renders (playback ticks…) never recompute them. */
const cache = new Map<string, unknown>();
function cached<T>(key: string, compute: () => T): T {
  if (cache.has(key)) return cache.get(key) as T;
  const value = compute();
  cache.set(key, value);
  if (cache.size > 80) cache.delete(cache.keys().next().value as string);
  return value;
}

const signature = (chord: Chord) => new Map(chordTones(chord).map((tone) => [tone.degree, tone.name]));

/** What changed between two chords, degree by degree: the core of «elijo Cmaj9 y veo qué cambió». */
function ChordChange({ from, to }: { from: Chord; to: Chord }) {
  const a = signature(from);
  const b = signature(to);
  const added = [...b].filter(([degree]) => !a.has(degree));
  const removed = [...a].filter(([degree]) => !b.has(degree));
  if (!added.length && !removed.length) return null;
  return (
    <p className="lab-change" aria-live="polite">
      Desde <b>{chordSymbol(from)}</b>:
      {added.map(([degree, name]) => (<span key={`a${degree}`} className="chip add">+ {degree} ({name})</span>))}
      {removed.map(([degree, name]) => (<span key={`r${degree}`} className="chip del">− {degree} ({name})</span>))}
    </p>
  );
}

function VoicingCard({ voicing, symbol, selected, compared, playingId, onSelect, onPlay, onCompare }: {
  voicing: Voicing; symbol: string; selected: boolean; compared: boolean; playingId: string | null;
  onSelect: () => void; onPlay: () => void; onCompare: () => void;
}) {
  const label = `${symbol} ${shapeLabel(voicing)}, ${INVERSION_NAMES[voicing.inversion].toLowerCase()}, traste ${voicing.position}`;
  return (
    <li className={`voicing-card${selected ? ' on' : ''}${compared ? ' cmp' : ''}`}>
      <button type="button" className="voicing-pick" aria-pressed={selected} aria-label={`Ver ${label}`} onClick={onSelect}>
        <ChordDiagram voicing={voicing} label={label} size={0.82} />
        <span className="voicing-shape">{shapeLabel(voicing)}</span>
        <span className="voicing-meta">{INVERSION_NAMES[voicing.inversion]}</span>
        {voicing.omitted.length > 0 && <span className="voicing-omit">sin {voicing.omitted.join(', ')}</span>}
      </button>
      <span className="voicing-actions">
        <button type="button" className="icon-btn" aria-label={playingId === voicing.id ? 'Detener' : `Escuchar ${label}`} onClick={onPlay}>
          <Icon name={playingId === voicing.id ? 'stop' : 'play'} size={14} />
        </button>
        <button type="button" className={`icon-btn${compared ? ' on' : ''}`} aria-pressed={compared} aria-label={`Comparar ${label}`} title="Comparar" onClick={onCompare}>
          <Icon name="columns" size={14} />
        </button>
      </span>
    </li>
  );
}

type Zone = 'all' | 'low' | 'mid' | 'high';
type StringFilter = 'all' | '3' | '4' | '5+';
type KindFilter = 'all' | 'open' | 'barre' | 'closed';

/**
 * The chord laboratory: formula, what changed, a large neck that is EITHER a map of every chord tone OR one playable
 * shape (never both at once), shapes filtered by zone / strings / bass / type, comparison of two, and explicit saving.
 */
export function ChordLab({ chord, setChord, style, tuning, bpm, canAddChord, onAddChord, onSaveVoicing }: {
  chord: string; setChord: (symbol: string) => void; style: Style; tuning: readonly string[]; bpm: number;
  canAddChord: boolean; onAddChord: (symbol: string) => void; onSaveVoicing?: SaveVoicing;
}) {
  const parsed = parseChord(chord);
  const [text, setText] = useState(chord);
  // The chord before the current one: «elijo Cmaj9 y veo qué cambió». Derived during render, no effect needed.
  const [seen, setSeen] = useState(chord);
  const [from, setFrom] = useState<Chord | null>(null);
  if (seen !== chord) {
    const before = parseChord(seen);
    setSeen(chord);
    setText(chord);
    if (before && parsed && chordSymbol(before) !== chordSymbol(parsed)) setFrom(before);
  }

  const [view, setView] = useState<'map' | 'shape'>('shape');
  const [zone, setZone] = useState<Zone>('all');
  const [strings, setStrings] = useState<StringFilter>('all');
  const [bass, setBass] = useState<'any' | Inversion>('any');
  const [kind, setKind] = useState<KindFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [strum, setStrum] = useState(true);
  const player = useVoicingPlayer(bpm);

  const chordKey = parsed ? chordSymbol(parsed) : '';
  const voicings = cached(`v|${chordKey}|${tuning.join(' ')}|${zone}|${strings}|${bass}|${kind}`, () => {
    const parsed = parseChord(chordKey);
    if (!parsed) return [];
    const range = { all: [0, 15], low: [0, 4], mid: [5, 9], high: [10, 15] }[zone];
    const counts = { all: [3, 6], '3': [3, 3], '4': [4, 4], '5+': [5, 6] }[strings];
    return generateVoicings(parsed, {
      tuning,
      maxFret: 15,
      minPosition: range[0],
      maxPosition: range[1],
      open: zone === 'all' || zone === 'low',
      minStrings: Math.max(counts[0], Math.min(3, chordTones(parsed).length)),
      maxStrings: counts[1],
      bass,
      limit: 400,
    }).filter((voicing) => kind === 'all' || voicing.kind === kind);
  });

  const shown = voicings.slice(0, 24);
  const selected = voicings.find((voicing) => voicing.id === selectedId) ?? shown[0];
  const symbol = parsed ? chordSymbol(parsed) : chord;
  const comparedVoicings = compare.map((id) => voicings.find((voicing) => voicing.id === id)).filter((item): item is Voicing => Boolean(item));
  const mapNotes = cached(`m|${chordKey}|${tuning.join(' ')}`, () => {
    const parsed = parseChord(chordKey);
    return parsed ? chordMap(parsed, tuning, 0, 15) : [];
  });
  const tones = parsed ? chordTones(parsed) : [];
  const toggleCompare = (id: string) => setCompare((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list.slice(-1), id]));
  const standard = tuning.join(' ') === 'E4 B3 G3 D3 A2 E2';

  return (
    <div className="tool-section lab">
      <form className="tool-form" onSubmit={(event) => { event.preventDefault(); const next = parseChord(text); if (next) setChord(chordSymbol(next)); }}>
        <label className="field"><span>Acorde (símbolo)</span>
          <input aria-label="Símbolo de acorde" value={text} aria-invalid={!parseChord(text)} onChange={(event) => setText(event.target.value)} onBlur={() => { const next = parseChord(text); if (next) setChord(chordSymbol(next)); }} placeholder="Cmaj7, Am9, G7♭9…" />
        </label>
        <label className="field"><span>Raíz</span>
          <select aria-label="Raíz del acorde" value={parsed?.rootPc ?? 0} onChange={(event) => setChord(prettyRoot(`${ROOTS[Number(event.target.value)]}`) + (parsed?.quality.suffix ?? ''))}>
            {ROOTS.map((_, pc) => (<option key={pc} value={pc}>{pitchClassName(pc, style, [3, 8, 10].includes(pc) ? 'flat' : 'sharp')}</option>))}
          </select>
        </label>
        <label className="field"><span>Tipo</span>
          <select aria-label="Tipo de acorde" value={parsed?.quality.id ?? 'maj'} onChange={(event) => { const quality = QUALITIES.find((item) => item.id === event.target.value)!; setChord(`${prettyRoot(parsed?.root ?? 'C')}${quality.suffix}`); }}>
            {QUALITY_GROUPS.map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.ids.map((id) => QUALITIES.find((quality) => quality.id === id)!).map((quality) => (<option key={quality.id} value={quality.id}>{quality.name}</option>))}
              </optgroup>
            ))}
          </select>
        </label>
      </form>
      {!parsed && <p className="muted small" role="alert">Escribí un acorde como C, Am, G7, Dm7, Cmaj9 o E7♯9. Las notas con octava (C4) son otra cosa: van en una melodía.</p>}
      {parsed && (
        <>
          <div className="lab-title">
            <h3 className="tool-title">{symbol} <span className="muted small">{parsed.quality.name}</span></h3>
            <p className="lab-formula" aria-label="Fórmula interválica">{parsed.quality.degrees.join(' – ')}</p>
          </div>
          {from && <ChordChange from={from} to={parsed} />}
          <ul className="chord-tones" aria-label="Notas del acorde">
            {tones.map((tone) => (
              <li key={tone.degree} className={`tone role-${tone.role}`}>
                <b>{tonicName(tone.name.replace('♯', '#').replace('♭', 'b'), style)}</b>
                <span>{tone.degree}</span>
                <small>{ROLE_NAMES[tone.role]}</small>
              </li>
            ))}
          </ul>
          <div className="lab-quick" role="group" aria-label="Variantes sobre la misma raíz">
            {['maj', 'maj7', 'maj9', 'add9', '7', '9', 'min', 'm7', 'm9', 'mMaj7', 'm7b5', 'dim7', 'sus4'].map((id) => {
              const quality = QUALITIES.find((item) => item.id === id)!;
              const next = `${prettyRoot(parsed.root)}${quality.suffix}`;
              return <button key={id} type="button" className={`pill${quality.id === parsed.quality.id ? ' on' : ''}`} aria-pressed={quality.id === parsed.quality.id} onClick={() => setChord(next)}>{next}</button>;
            })}
          </div>

          <div className="tool-head">
            <Segmented<'map' | 'shape'> label="Qué muestra el mástil" value={view} onChange={setView} options={[{ value: 'shape', label: 'Digitación tocable' }, { value: 'map', label: 'Mapa armónico' }]} />
            {!standard && <span className="muted small">Afinación del cuaderno: {tuning.slice().reverse().join(' ')}</span>}
          </div>
          {view === 'map' ? (
            <>
              <FretboardCanvas tuning={[...tuning]} latin={style === 'latin'} from={0} to={15} markers={markersOf(mapNotes, style)} label={`Notas de ${symbol} en el mástil: mapa hasta el traste 15`} maxCell={64} minCell={30} />
              <p className="muted small">Mapa de posibilidades: todas las notas del acorde en el mástil. No es una digitación: no se tocan todas a la vez.</p>
            </>
          ) : selected ? (
            <>
              <FretboardCanvas
                tuning={[...tuning]}
                latin={style === 'latin'}
                from={Math.max(0, selected.position <= 3 ? 0 : selected.position - 1)}
                to={Math.min(15, Math.max(selected.position + 4, 5))}
                markers={markersOf(selected.notes, style)}
                label={`Notas de ${symbol} en el mástil: digitación ${shapeLabel(selected)}`}
                maxCell={78}
                minCell={40}
              />
              <p className="lab-shape-facts">
                <b>{shapeLabel(selected)}</b> · {INVERSION_NAMES[selected.inversion]} (bajo: {selected.bass.name}) · {selected.strings} cuerdas · {selected.fingers} {selected.fingers === 1 ? 'dedo' : 'dedos'}
                {selected.barre && ` · cejilla en el traste ${selected.barre.fret}`}
                {selected.frets.some((fret) => fret === null) && ` · no suenan: ${selected.frets.map((fret, index) => (fret === null ? index + 1 : null)).filter(Boolean).join(', ')}`}
                {selected.omitted.length > 0 && <span className="voicing-omit"> · omite {selected.omitted.join(', ')}</span>}
              </p>
              <div className="tool-actions">
                <button type="button" className="btn btn-primary" onClick={() => (player.playingId === selected.id ? player.stop() : player.play(selected, strum))}>
                  <Icon name={player.playingId === selected.id ? 'stop' : 'play'} size={14} /> {player.playingId === selected.id ? 'Detener' : 'Escuchar'}
                </button>
                <Segmented<'strum' | 'block'> label="Cómo suena" value={strum ? 'strum' : 'block'} onChange={(value) => setStrum(value === 'strum')} options={[{ value: 'strum', label: 'Rasgueado' }, { value: 'block', label: 'Simultáneo' }]} />
                <button type="button" className="btn" disabled={!canAddChord} title={canAddChord ? undefined : 'Abrí un cuaderno con un bloque de acordes'} onClick={() => onAddChord(symbol)}>Agregar a la progresión</button>
                <button type="button" className="btn" disabled={!onSaveVoicing} title={onSaveVoicing ? undefined : 'Abrí un cuaderno para guardar la posición'} onClick={() => onSaveVoicing?.(`${symbol} · ${shapeLabel(selected)}`, parsed.rootPc, selected.notes.map((note) => ({ string: note.string, fret: note.fret, root: note.role === 'root' })))}>
                  Guardar posición como mapa
                </button>
              </div>
              <p className="muted small">Sonido sintetizado: orienta el oído, no reproduce una guitarra real.</p>
            </>
          ) : (
            <p className="muted">No hay posiciones con esos filtros.</p>
          )}

          <CompareTables root={prettyRoot(parsed.root)} current={parsed.quality.id} setChord={setChord} />

          {view === 'shape' && (
            <>
              <div className="lab-filters" role="group" aria-label="Filtrar posiciones">
                <label className="field"><span>Zona</span>
                  <select aria-label="Zona del mástil" value={zone} onChange={(event) => setZone(event.target.value as Zone)}>
                    <option value="all">Todo el mástil</option><option value="low">Trastes 0–4</option><option value="mid">Trastes 5–9</option><option value="high">Trastes 10–15</option>
                  </select>
                </label>
                <label className="field"><span>Cuerdas</span>
                  <select aria-label="Cantidad de cuerdas" value={strings} onChange={(event) => setStrings(event.target.value as StringFilter)}>
                    <option value="all">Todas</option><option value="3">3 cuerdas</option><option value="4">4 cuerdas</option><option value="5+">5 o 6</option>
                  </select>
                </label>
                <label className="field"><span>Bajo</span>
                  <select aria-label="Nota del bajo" value={bass} onChange={(event) => setBass(event.target.value as 'any' | Inversion)}>
                    <option value="any">Cualquiera</option><option value="root">Tónica en el bajo</option><option value="first">1ª inversión</option><option value="second">2ª inversión</option>
                    {tones.some((tone) => tone.role === 'seventh') && <option value="third">3ª inversión</option>}
                  </select>
                </label>
                <label className="field"><span>Tipo</span>
                  <select aria-label="Tipo de posición" value={kind} onChange={(event) => setKind(event.target.value as KindFilter)}>
                    <option value="all">Todas</option><option value="open">Con cuerdas al aire</option><option value="barre">Con cejilla</option><option value="closed">Cerradas (móviles)</option>
                  </select>
                </label>
              </div>
              <p className="muted small" aria-live="polite">{voicings.length === 0 ? 'Ninguna posición cumple esos filtros.' : `${voicings.length} posiciones verificadas${voicings.length > shown.length ? `; se muestran las ${shown.length} más cómodas` : ''}. Cada nota se calcula con la afinación.`}</p>
              <ul className="voicing-grid" aria-label={`Posiciones de ${symbol}`}>
                {shown.map((voicing) => (
                  <VoicingCard
                    key={voicing.id}
                    voicing={voicing}
                    symbol={symbol}
                    selected={voicing.id === selected?.id}
                    compared={compare.includes(voicing.id)}
                    playingId={player.playingId}
                    onSelect={() => setSelectedId(voicing.id)}
                    onPlay={() => (player.playingId === voicing.id ? player.stop() : player.play(voicing, strum))}
                    onCompare={() => toggleCompare(voicing.id)}
                  />
                ))}
              </ul>
              {comparedVoicings.length > 0 && <Comparison voicings={comparedVoicings} symbol={symbol} style={style} onClear={() => setCompare([])} />}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Same root, every triad and seventh side by side: the intervals that tell them apart. */
function CompareTables({ root, current, setChord }: { root: string; current: string; setChord: (symbol: string) => void }) {
  const table = (title: string, ids: string[]) => (
    <>
      <h4>{title} sobre {root}</h4>
      <table className="tool-table compare">
        <tbody>
          {ids.map((id) => QUALITIES.find((quality) => quality.id === id)!).map((quality) => (
            <tr key={quality.id} className={quality.id === current ? 'on' : ''}>
              <th scope="row"><button type="button" className="btn btn-link" onClick={() => setChord(`${root}${quality.suffix}`)}>{quality.name}</button></th>
              <td>{quality.degrees.join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
  return (
    <>
      {table('Tríadas', ['maj', 'min', 'dim', 'aug'])}
      {table('Séptimas', ['maj7', '7', 'm7', 'mMaj7', 'm7b5', 'dim7'])}
    </>
  );
}

function Comparison({ voicings, symbol, style, onClear }: { voicings: Voicing[]; symbol: string; style: Style; onClear: () => void }) {
  const [a, b] = voicings;
  const shared = b ? a.notes.filter((note) => b.notes.some((other) => other.midi === note.midi)).length : 0;
  return (
    <section className="lab-compare" aria-label="Comparación de posiciones">
      <header className="tool-head">
        <h4>Comparar {b ? 'dos posiciones' : '(elegí otra)'}</h4>
        <button type="button" className="btn btn-link" onClick={onClear}>Limpiar</button>
      </header>
      <div className="lab-compare-row">
        {voicings.map((voicing) => (
          <figure key={voicing.id}>
            <ChordDiagram voicing={voicing} label={`${symbol} ${shapeLabel(voicing)}`} size={1.15} />
            <figcaption>
              <b>{shapeLabel(voicing)}</b>
              <span>{INVERSION_NAMES[voicing.inversion]}</span>
              <span className="muted small">Grave → agudo: {voicing.notes.map((note) => tonicName(note.name.replace('♯', '#').replace('♭', 'b'), style)).join(' · ')}</span>
              <span className="muted small">Intervalos: {voicing.notes.map((note) => note.degree).join(' · ')}</span>
              {voicing.omitted.length > 0 && <span className="voicing-omit">Omite {voicing.omitted.join(', ')}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
      {b && <p className="muted small">Notas exactamente iguales (misma altura): {shared}. Bajo: {a.bass.name} → {b.bass.name}. Traste: {a.position} → {b.position}.</p>}
    </section>
  );
}

/** Triads (3 strings) and sevenths (4 strings) on adjacent string sets, every inversion along the neck. */
export function TriadLab({ style, tuning, bpm, initialRoot }: { style: Style; tuning: readonly string[]; bpm: number; initialRoot?: string }) {
  const [root, setRoot] = useState(initialRoot ?? 'C');
  const [qualityId, setQualityId] = useState('maj');
  const [setIndex, setSetIndex] = useState(0);
  const [inversion, setInversion] = useState<'any' | Inversion>('any');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const player = useVoicingPlayer(bpm);
  const quality = QUALITIES.find((item) => item.id === qualityId)!;
  const isSeventh = quality.intervals.length === 4;
  const sets = isSeventh ? FOUR_STRING_SETS : TRIAD_STRING_SETS;
  const set = sets[Math.min(setIndex, sets.length - 1)];
  const chord = parseChord(`${root}${quality.suffix}`)!;
  const symbol = chordSymbol(chord);
  const setKey = set.join(',');
  const all = cached(`s|${symbol}|${tuning.join(' ')}|${setKey}`, () => stringSetVoicings(chord, tuning, set, 15));
  const list = all.filter((voicing) => inversion === 'any' || voicing.inversion === inversion);
  const selected = list.find((voicing) => voicing.id === selectedId) ?? list[0];
  const tones = chordTones(chord);
  const order = (inv: Inversion) => {
    const start = { root: 0, first: 1, second: 2, third: 3, other: 0 }[inv];
    return [...tones.slice(start), ...tones.slice(0, start)].map((tone) => tone.name).join('–');
  };
  const compared = compare.map((id) => all.find((voicing) => voicing.id === id)).filter((item): item is Voicing => Boolean(item));
  const inversions: Inversion[] = isSeventh ? ['root', 'first', 'second', 'third'] : ['root', 'first', 'second'];

  return (
    <div className="tool-section lab">
      <p className="muted small">Cuerdas numeradas como en la guitarra: 1 es la más aguda (Mi agudo), 6 la más grave.</p>
      <div className="lab-filters" role="group" aria-label="Elegir tríada">
        <label className="field"><span>Raíz</span>
          <select aria-label="Raíz" value={root} onChange={(event) => setRoot(event.target.value)}>
            {ROOTS.map((name, pc) => (<option key={name} value={name}>{pitchClassName(pc, style, [3, 8, 10].includes(pc) ? 'flat' : 'sharp')}</option>))}
          </select>
        </label>
        <label className="field"><span>Tipo</span>
          <select aria-label="Tipo" value={qualityId} onChange={(event) => { setQualityId(event.target.value); setSetIndex(0); setInversion('any'); }}>
            <optgroup label="Tríadas">{['maj', 'min', 'dim', 'aug'].map((id) => <option key={id} value={id}>{QUALITIES.find((item) => item.id === id)!.name}</option>)}</optgroup>
            <optgroup label="Séptimas (4 cuerdas)">{['maj7', '7', 'm7', 'm7b5', 'dim7'].map((id) => <option key={id} value={id}>{QUALITIES.find((item) => item.id === id)!.name}</option>)}</optgroup>
          </select>
        </label>
        <label className="field"><span>Juego de cuerdas</span>
          <select aria-label="Juego de cuerdas" value={setIndex} onChange={(event) => setSetIndex(Number(event.target.value))}>
            {sets.map((item, index) => (<option key={item.join()} value={index}>Cuerdas {item.join('–')}</option>))}
          </select>
        </label>
        <label className="field"><span>Inversión</span>
          <select aria-label="Inversión" value={inversion} onChange={(event) => setInversion(event.target.value as 'any' | Inversion)}>
            <option value="any">Todas</option>
            {inversions.map((inv) => (<option key={inv} value={inv}>{INVERSION_NAMES[inv]}</option>))}
          </select>
        </label>
      </div>
      <ul className="inversion-legend" aria-label="Orden de las notas en cada inversión">
        {inversions.map((inv) => (<li key={inv}><b>{INVERSION_NAMES[inv]}</b> <span>{order(inv)}</span></li>))}
      </ul>
      {selected ? (
        <>
          <FretboardCanvas tuning={[...tuning]} latin={style === 'latin'} from={0} to={15} markers={markersOf(selected.notes, style)} label={`${symbol} ${shapeLabel(selected)} en las cuerdas ${set.join('–')}`} maxCell={64} minCell={30} />
          <p className="lab-shape-facts"><b>{symbol}</b> · {INVERSION_NAMES[selected.inversion]} · bajo {selected.bass.name} (cuerda {selected.bass.string}) · traste {selected.position} · {selected.notes.map((note) => `${note.name} (${note.degree})`).join(' · ')}</p>
          <div className="tool-actions">
            <button type="button" className="btn btn-primary" onClick={() => (player.playingId === selected.id ? player.stop() : player.play(selected, true))}>
              <Icon name={player.playingId === selected.id ? 'stop' : 'play'} size={14} /> {player.playingId === selected.id ? 'Detener' : 'Escuchar'}
            </button>
          </div>
        </>
      ) : (
        <p className="muted">No hay posiciones para esa combinación.</p>
      )}
      <ul className="voicing-grid" aria-label={`${symbol} en las cuerdas ${set.join('–')}`}>
        {list.map((voicing) => (
          <VoicingCard
            key={voicing.id}
            voicing={voicing}
            symbol={symbol}
            selected={voicing.id === selected?.id}
            compared={compare.includes(voicing.id)}
            playingId={player.playingId}
            onSelect={() => setSelectedId(voicing.id)}
            onPlay={() => (player.playingId === voicing.id ? player.stop() : player.play(voicing, true))}
            onCompare={() => setCompare((current) => (current.includes(voicing.id) ? current.filter((id) => id !== voicing.id) : [...current.slice(-1), voicing.id]))}
          />
        ))}
      </ul>
      {compared.length > 0 && <Comparison voicings={compared} symbol={symbol} style={style} onClear={() => setCompare([])} />}
    </div>
  );
}
