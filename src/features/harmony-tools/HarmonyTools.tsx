import { useEffect, useMemo, useState } from 'react';
import { transport, useTransport } from '@/audio/engine';
import { progressionToSequence } from '@/audio/plan';
import type { KeySignature } from '@/core/model';
import { chordPitchClasses, chordSymbol, chordTones, parseChord, QUALITIES } from '@/core/theory/chords';
import {
  accidentalsOf, allKeys, diatonicChords, keyTitle, modulation, neighbors, relativeOf, sameKey, scaleOf, tonicName, tonicPc,
  type KeyRef,
} from '@/core/theory/keys';
import { pitchClassName } from '@/core/theory/pitch';
import { STANDARD_TUNING } from '@/core/music';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { FretboardCanvas, type Marker } from '@/features/fretboard/FretboardCanvas';
import { CircleOfFifths } from '@/features/harmony-tools/CircleOfFifths';
import { useNoteStyle } from '@/features/melody/note-style';
import { useMetronome } from '@/features/metronome/metronome-context';
import { useSoundPrefs } from '@/audio/useBlockPlayer';

type Tab = 'circle' | 'chords' | 'modulation';
const OWNER = 'harmony-tools';

export type ToolsContext = {
  /** The notebook's key: where exploring starts. Exploring never edits it. */
  key?: KeySignature;
  chord?: string;
  bpm?: number;
};
export type ToolsActions = {
  /** Explicit actions only: nothing here runs just because something was clicked in the explorer. */
  canAddChord: boolean;
  onAddChord: (symbol: string) => void;
  onUseKey: (key: KeySignature) => void;
  onCreateMap: (key: KeyRef) => void;
  onAddProgression: (symbols: string[]) => void;
};

function useListen(bpm: number) {
  const snapshot = useTransport();
  const prefs = useSoundPrefs();
  useEffect(() => () => {
    if (transport.snapshot().owner === OWNER) transport.stop();
  }, []);
  return {
    playing: snapshot.owner === OWNER && snapshot.state === 'playing',
    play: (symbols: string[], beats = 2) =>
      transport.play({ owner: OWNER, sequence: progressionToSequence(symbols, beats), bpm, instrument: prefs.instrumentFor('chords') }),
    stop: () => transport.stop(),
  };
}

const keyValue = (key: KeyRef) => `${key.tonic}:${key.mode}`;

function KeySelect({ label, value, onChange, style }: { label: string; value: KeyRef; onChange: (key: KeyRef) => void; style: 'latin' | 'english' }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={keyValue(value)}
        onChange={(event) => {
          const [tonic, mode] = event.target.value.split(':');
          onChange({ tonic, mode: mode as KeyRef['mode'] });
        }}
      >
        {allKeys().map((key) => (
          <option key={keyValue(key)} value={keyValue(key)}>{keyTitle(key, style)}</option>
        ))}
      </select>
    </label>
  );
}

function ChordPills({ symbols, onPick }: { symbols: string[]; onPick?: (symbol: string) => void }) {
  return (
    <span className="pill-row">
      {symbols.map((symbol, index) => (
        <button key={`${symbol}-${index}`} type="button" className="pill" disabled={!onPick} onClick={() => onPick?.(symbol)}>{symbol}</button>
      ))}
    </span>
  );
}

function CircleTab({ selected, setSelected, ctx, actions, style, listen, openChord }: {
  selected: KeyRef; setSelected: (key: KeyRef) => void; ctx: ToolsContext; actions: ToolsActions; style: 'latin' | 'english';
  listen: ReturnType<typeof useListen>; openChord: (symbol: string) => void;
}) {
  const [sevenths, setSevenths] = useState(false);
  const scale = scaleOf(selected);
  const chords = diatonicChords(selected, sevenths);
  const accidentals = accidentalsOf(selected);
  const relative = relativeOf(selected);
  const names = scale.map((note) => tonicName(note, style));
  return (
    <div className="tool-section">
      <CircleOfFifths selected={selected} style={style} onSelect={setSelected} documentKey={ctx.key} />
      <ul className="cof-legend" aria-label="Cómo leer el círculo">
        <li><i className="swatch sel" /> Tonalidad elegida</li>
        <li><i className="swatch rel" /> Su relativa</li>
        <li><i className="swatch near" /> Una quinta arriba / abajo</li>
        {ctx.key && <li><i className="swatch doc" /> Tonalidad del cuaderno</li>}
      </ul>
      <h3 className="tool-title">{keyTitle(selected, style)}</h3>
      <p className="tool-line" aria-label="Notas de la escala">
        {names.map((name, index) => (<span key={index} className={`degree${index === 0 ? ' r' : index === 2 ? ' t' : index === 4 ? ' f' : ''}`}>{name}</span>))}
      </p>
      <p className="muted small">
        {accidentals.notes.length === 0 ? 'Sin alteraciones.' : `${accidentals.sharps ? `${accidentals.sharps} ${accidentals.sharps === 1 ? 'sostenido' : 'sostenidos'}` : `${accidentals.flats} ${accidentals.flats === 1 ? 'bemol' : 'bemoles'}`}: ${accidentals.notes.map((note) => tonicName(note, style)).join(', ')}.`}{' '}
        Relativa {selected.mode === 'major' ? 'menor' : 'mayor'}: <button type="button" className="btn btn-link" onClick={() => setSelected(relative)}>{keyTitle(relative, style)}</button>.
        {selected.mode === 'minor' && ' Se muestra la menor natural.'}
      </p>
      <div className="tool-head">
        <h4>Acordes de la tonalidad</h4>
        <Segmented<'triads' | 'sevenths'> label="Tipo de acordes" value={sevenths ? 'sevenths' : 'triads'} onChange={(value) => setSevenths(value === 'sevenths')} options={[{ value: 'triads', label: 'Tríadas' }, { value: 'sevenths', label: 'Séptimas' }]} />
      </div>
      <table className="tool-table">
        <thead><tr><th scope="col">Grado</th><th scope="col">Acorde</th><th scope="col">Función</th></tr></thead>
        <tbody>
          {chords.map((chord) => (
            <tr key={chord.degree}>
              <th scope="row">{chord.roman}</th>
              <td><button type="button" className="pill" onClick={() => openChord(chord.symbol)} aria-label={`Ver el acorde ${chord.symbol}`}>{chord.symbol}</button></td>
              <td className="muted">{chord.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tool-actions">
        <button type="button" className="btn" onClick={() => (listen.playing ? listen.stop() : void listen.play(chords.map((chord) => chord.symbol), 2))}>
          <Icon name={listen.playing ? 'stop' : 'play'} size={14} /> {listen.playing ? 'Detener' : 'Escuchar los acordes'}
        </button>
        <button type="button" className="btn" onClick={() => actions.onCreateMap(selected)}>Crear un mapa de esta escala en el cuaderno</button>
        <button type="button" className="btn" disabled={ctx.key && sameKey(ctx.key as KeyRef, selected)} onClick={() => actions.onUseKey(selected)}>
          Usar {keyTitle(selected, style)} como tonalidad del cuaderno
        </button>
      </div>
      <h4>Tonalidades cercanas</h4>
      <ul className="tool-list">
        {neighbors(selected).map((item) => (
          <li key={item.relation}>
            <button type="button" className="btn btn-link" onClick={() => setSelected(item.key)}>{keyTitle(item.key, style)}</button>
            <span className="muted"> — {item.relation}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function neckMarkers(chordText: string): { markers: Marker[]; error?: string } {
  const chord = parseChord(chordText);
  if (!chord) return { markers: [], error: 'No reconozco ese acorde.' };
  const tones = chordTones(chord);
  const pcs = new Map(tones.map((tone) => [tone.pc, tone]));
  const markers: Marker[] = [];
  STANDARD_TUNING.forEach((open, string) => {
    for (let fret = 0; fret <= 12; fret += 1) {
      const pc = (tonicPcOf(open) + fret) % 12;
      const tone = pcs.get(pc);
      if (tone) markers.push({ string, fret, label: tone.name, sub: tone.degree, tone: tone.role === 'root' ? 'root' : 'note', role: tone.role === 'other' ? undefined : tone.role });
    }
  });
  return { markers };
}
const tonicPcOf = (open: string) => tonicPc(open.slice(0, -1));

function ChordsTab({ chord, setChord, actions, style, listen }: { chord: string; setChord: (symbol: string) => void; actions: ToolsActions; style: 'latin' | 'english'; listen: ReturnType<typeof useListen> }) {
  const parsed = parseChord(chord);
  const [text, setText] = useState(chord);
  const root = parsed?.root ?? 'C';
  const tones = parsed ? chordTones(parsed) : [];
  const { markers } = useMemo(() => neckMarkers(chord), [chord]);
  const sameRoot = (suffixIds: string[]) => suffixIds.map((id) => QUALITIES.find((quality) => quality.id === id)!);
  return (
    <div className="tool-section">
      <form className="tool-form" onSubmit={(event) => { event.preventDefault(); const next = parseChord(text); if (next) setChord(chordSymbol(next)); }}>
        <label className="field"><span>Acorde (símbolo)</span>
          <input aria-label="Símbolo de acorde" value={text} aria-invalid={!parseChord(text)} onChange={(event) => setText(event.target.value)} placeholder="Cmaj7, Am, G7…" />
        </label>
        <label className="field"><span>Raíz</span>
          <select aria-label="Raíz del acorde" value={parsed?.rootPc ?? 0} onChange={(event) => setChord(`${['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][Number(event.target.value)]}${parsed?.quality.suffix ?? ''}`.replace('#', '♯').replace(/(?<=[A-G])b/, '♭'))}>
            {Array.from({ length: 12 }, (_, pc) => (<option key={pc} value={pc}>{pitchClassName(pc, style, pc === 3 || pc === 8 || pc === 10 ? 'flat' : 'sharp')}</option>))}
          </select>
        </label>
        <label className="field"><span>Tipo</span>
          <select aria-label="Tipo de acorde" value={parsed?.quality.id ?? 'maj'} onChange={(event) => { const quality = QUALITIES.find((item) => item.id === event.target.value)!; setChord(`${root}${quality.suffix}`); }}>
            {QUALITIES.map((quality) => (<option key={quality.id} value={quality.id}>{quality.name}</option>))}
          </select>
        </label>
      </form>
      {!parsed && <p className="muted small" role="alert">Escribí un acorde como C, Am, G7, Dm7 o Cmaj7. Las notas con octava (C4) son otra cosa: van en una melodía.</p>}
      {parsed && (
        <>
          <h3 className="tool-title">{chordSymbol(parsed)} <span className="muted small">{parsed.quality.name}</span></h3>
          <ul className="chord-tones" aria-label="Notas del acorde">
            {tones.map((tone) => (
              <li key={tone.degree} className={`tone role-${tone.role}`}>
                <b>{tonicName(tone.name.replace('♯', '#').replace('♭', 'b'), style)}</b>
                <span>{tone.degree}</span>
                <small>{{ root: 'tónica', third: 'tercera', fifth: 'quinta', seventh: 'séptima', other: 'otra' }[tone.role]}</small>
              </li>
            ))}
          </ul>
          <FretboardCanvas tuning={[...STANDARD_TUNING]} latin={style === 'latin'} from={0} to={12} markers={markers} label={`Notas de ${chordSymbol(parsed)} en el mástil`} maxCell={44} minCell={22} />
          <p className="muted small">Se muestran todas las notas del acorde en los primeros 12 trastes. No se sugieren digitaciones.</p>
          <div className="tool-actions">
            <button type="button" className="btn" onClick={() => (listen.playing ? listen.stop() : void listen.play([chordSymbol(parsed)], 4))}>
              <Icon name={listen.playing ? 'stop' : 'play'} size={14} /> {listen.playing ? 'Detener' : 'Escuchar'}
            </button>
            <button type="button" className="btn" disabled={!actions.canAddChord} title={actions.canAddChord ? undefined : 'Seleccioná o creá un bloque de acordes en tu cuaderno'} onClick={() => actions.onAddChord(chordSymbol(parsed))}>
              Agregar a la progresión
            </button>
          </div>
          <h4>Tríadas sobre {root.replace('#', '♯').replace(/(?<=[A-G])b/, '♭')}</h4>
          <table className="tool-table compare">
            <thead><tr><th scope="col">Tipo</th><th scope="col">Intervalos</th></tr></thead>
            <tbody>
              {sameRoot(['maj', 'min', 'dim', 'aug']).map((quality) => (
                <tr key={quality.id} className={quality.id === parsed.quality.id ? 'on' : ''}>
                  <th scope="row"><button type="button" className="btn btn-link" onClick={() => setChord(`${root}${quality.suffix}`.replace('#', '♯').replace(/(?<=[A-G])b/, '♭'))}>{quality.name}</button></th>
                  <td>{quality.degrees.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>Séptimas</h4>
          <table className="tool-table compare">
            <tbody>
              {sameRoot(['maj7', '7', 'm7', 'm7b5', 'dim7']).map((quality) => (
                <tr key={quality.id} className={quality.id === parsed.quality.id ? 'on' : ''}>
                  <th scope="row"><button type="button" className="btn btn-link" onClick={() => setChord(`${root}${quality.suffix}`.replace('#', '♯').replace(/(?<=[A-G])b/, '♭'))}>{quality.name}</button></th>
                  <td>{chordPitchClasses(parseChord(`${root}${quality.suffix}`.replace('♯', '#').replace('♭', 'b'))!).length} notas · {quality.degrees.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function ModulationTab({ from, setFrom, to, setTo, actions, style, listen }: {
  from: KeyRef; setFrom: (key: KeyRef) => void; to: KeyRef; setTo: (key: KeyRef) => void; actions: ToolsActions; style: 'latin' | 'english'; listen: ReturnType<typeof useListen>;
}) {
  const result = useMemo(() => modulation(from, to), [from, to]);
  const same = sameKey(from, to);
  const show = (note: string) => tonicName(note.replace('♯', '#').replace('♭', 'b'), style);
  return (
    <div className="tool-section">
      <div className="mod-pickers">
        <KeySelect label="Origen" value={from} onChange={setFrom} style={style} />
        <KeySelect label="Destino" value={to} onChange={setTo} style={style} />
      </div>
      <CircleOfFifths selected={from} target={to} style={style} onSelect={setTo} />
      <p className="muted small">Tocá una tonalidad del círculo para elegirla como destino.</p>
      {same ? (
        <p className="muted">Elegí un destino distinto del origen.</p>
      ) : (
        <>
          <p className="tool-line"><b>{keyTitle(from, style)}</b> → <b>{keyTitle(to, style)}</b> · {result.distance === 0 ? 'misma armadura' : `${result.distance} ${result.distance === 1 ? 'paso' : 'pasos'} en el círculo`}</p>
          <dl className="mod-facts">
            <dt>Notas en común</dt><dd>{result.commonNotes.map(show).join(' ')} <span className="muted">({result.commonNotes.length} de 7)</span></dd>
            <dt>Cambian</dt><dd>{result.changed.length ? result.changed.map((pair) => `${show(pair.from)} → ${show(pair.to)}`).join(', ') : 'Ninguna: son relativas.'}</dd>
            <dt>Acordes en común</dt>
            <dd>{result.commonChords.length ? (<ul className="tool-list">{result.commonChords.map((chord) => (<li key={chord.symbol}><b>{chord.symbol}</b> <span className="muted">es {chord.fromRoman} en {keyTitle(from, style)} y {chord.toRoman} en {keyTitle(to, style)}</span></li>))}</ul>) : 'Ninguno: el cambio es más brusco.'}</dd>
          </dl>
          <h4>Caminos posibles</h4>
          <p className="muted small">Hay muchas formas de modular. Estas son ideas para probar, no reglas.</p>
          <ul className="paths">
            {result.paths.map((path) => (
              <li key={path.name}>
                <strong>{path.name}</strong>
                <ChordPills symbols={path.chords} />
                <p className="muted small">{path.note}</p>
                <div className="tool-actions">
                  <button type="button" className="btn" onClick={() => void listen.play(path.chords, 2)}><Icon name="play" size={14} /> Escuchar</button>
                  <button type="button" className="btn" disabled={!actions.canAddChord} title={actions.canAddChord ? undefined : 'Seleccioná o creá un bloque de acordes en tu cuaderno'} onClick={() => actions.onAddProgression(path.chords)}>Agregar al cuaderno</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * The harmony explorer. It opens beside the notebook, starts from the notebook's key when there is one, and
 * changes nothing by itself: every effect on the music is a button with a name.
 */
export function HarmonyTools({ context, actions, onClose }: { context: ToolsContext; actions: ToolsActions; onClose: () => void }) {
  const [style] = useNoteStyle();
  const metro = useMetronome();
  const [tab, setTab] = useState<Tab>(context.chord ? 'chords' : 'circle');
  const startKey: KeyRef = context.key ?? { tonic: 'C', mode: 'major' };
  const [selected, setSelected] = useState<KeyRef>(startKey);
  const [target, setTarget] = useState<KeyRef>(neighbors(startKey)[0].key);
  const [chord, setChord] = useState(context.chord ?? 'C');
  const bpm = metro.practiceBpm ?? context.bpm ?? metro.baseBpm;
  const listen = useListen(bpm);

  return (
    <aside className="tools-panel" role="complementary" aria-label="Herramientas musicales">
      <header className="tools-head">
        <h2><Icon name="circle" size={16} /> Explorar armonía</h2>
        <button type="button" className="icon-btn" aria-label="Cerrar herramientas musicales" onClick={onClose}><Icon name="close" size={16} /></button>
      </header>
      <p className="muted small tools-note">Explorar no modifica tu composición. Solo los botones con nombre lo hacen.</p>
      <Segmented<Tab>
        label="Herramienta"
        value={tab}
        onChange={setTab}
        options={[{ value: 'circle', label: 'Círculo' }, { value: 'chords', label: 'Acordes' }, { value: 'modulation', label: 'Modulación' }]}
      />
      <div className="tools-body">
        {tab === 'circle' && (
          <CircleTab selected={selected} setSelected={setSelected} ctx={context} actions={actions} style={style} listen={listen} openChord={(symbol) => { setChord(symbol); setTab('chords'); }} />
        )}
        {tab === 'chords' && <ChordsTab key={chord} chord={chord} setChord={setChord} actions={actions} style={style} listen={listen} />}
        {tab === 'modulation' && <ModulationTab from={selected} setFrom={setSelected} to={target} setTo={setTarget} actions={actions} style={style} listen={listen} />}
      </div>
    </aside>
  );
}
