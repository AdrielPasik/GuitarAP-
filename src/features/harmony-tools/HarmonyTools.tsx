import { useEffect, useMemo, useState } from 'react';
import { transport, useTransport } from '@/audio/engine';
import { progressionToSequence } from '@/audio/plan';
import type { KeySignature } from '@/core/model';
import {
  accidentalsOf, allKeys, diatonicChords, keyTitle, modulation, neighbors, relativeOf, sameKey, scaleOf, tonicName,
  type KeyRef,
} from '@/core/theory/keys';
import { STANDARD_TUNING } from '@/core/music';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { CircleOfFifths } from '@/features/harmony-tools/CircleOfFifths';
import { useNoteStyle } from '@/features/melody/note-style';
import { useMetronome } from '@/features/metronome/metronome-context';
import { useSoundPrefs } from '@/audio/useBlockPlayer';
import { ChordLab, TriadLab, type SaveVoicing } from '@/features/harmony-tools/ChordLab';

type Tab = 'circle' | 'chords' | 'triads' | 'modulation';
export type HarmonyMode = 'side' | 'wide' | 'full';
const OWNER = 'harmony-tools';

export type ToolsContext = {
  /** The notebook's key: where exploring starts. Exploring never edits it. */
  key?: KeySignature;
  chord?: string;
  bpm?: number;
  /** The instrument's real tuning when the document has one (high string first). */
  tuning?: string[];
};
export type ToolsActions = {
  /** Explicit actions only: nothing here runs just because something was clicked in the explorer. */
  canAddChord: boolean;
  onAddChord: (symbol: string) => void;
  onUseKey: (key: KeySignature) => void;
  onCreateMap: (key: KeyRef) => void;
  onAddProgression: (symbols: string[]) => void;
  /** Explicit «Guardar posición como mapa». Absent with no document open. */
  onSaveVoicing?: SaveVoicing;
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

export type PanelLayout = { mode: HarmonyMode; setMode: (mode: HarmonyMode) => void; width: number; setWidth: (width: number) => void };
export const PANEL_MIN = 340;
export const PANEL_DEFAULT = 400;
export const panelMax = () => Math.max(PANEL_MIN, Math.min(1100, Math.round(window.innerWidth * 0.72)));

/** Drag (or arrow keys) on the panel's left edge. The width is a device preference, never part of a document. */
function Resizer({ width, setWidth }: { width: number; setWidth: (width: number) => void }) {
  const clamp = (value: number) => Math.max(PANEL_MIN, Math.min(panelMax(), Math.round(value)));
  return (
    <div
      className="tools-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Ancho del panel de armonía"
      aria-valuemin={PANEL_MIN}
      aria-valuemax={panelMax()}
      aria-valuenow={width}
      tabIndex={0}
      title="Arrastrá para cambiar el ancho. Doble clic: ancho original."
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); setWidth(clamp(width + 40)); }
        if (event.key === 'ArrowRight') { event.preventDefault(); setWidth(clamp(width - 40)); }
        if (event.key === 'Home') { event.preventDefault(); setWidth(PANEL_DEFAULT); }
      }}
      onDoubleClick={() => setWidth(PANEL_DEFAULT)}
      onPointerDown={(event) => {
        event.preventDefault();
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        const move = (moveEvent: PointerEvent) => setWidth(clamp(window.innerWidth - moveEvent.clientX));
        const up = () => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
      }}
    />
  );
}

/**
 * The harmony explorer, in three sizes: a side panel for quick looks, a wider resizable panel, and a full laboratory
 * over the current screen (the song stays open underneath, so «Volver» lands exactly where you were). It starts from
 * the notebook's key when there is one and changes nothing by itself: every effect on the music is a button with a name.
 */
export function HarmonyTools({ context, actions, hasDocument = true, onClose, layout }: { context: ToolsContext; actions: ToolsActions; hasDocument?: boolean; onClose: () => void; layout?: PanelLayout }) {
  const [style] = useNoteStyle();
  const metro = useMetronome();
  const [tab, setTab] = useState<Tab>(context.chord ? 'chords' : 'circle');
  const startKey: KeyRef = context.key ?? { tonic: 'C', mode: 'major' };
  const [selected, setSelected] = useState<KeyRef>(startKey);
  const [target, setTarget] = useState<KeyRef>(neighbors(startKey)[0].key);
  const [chord, setChord] = useState(context.chord ?? 'C');
  const bpm = metro.practiceBpm ?? context.bpm ?? metro.baseBpm;
  const listen = useListen(bpm);
  const tuning = context.tuning && context.tuning.length >= 4 ? context.tuning : [...STANDARD_TUNING];
  const mode = layout?.mode ?? 'side';
  const setMode = layout?.setMode;

  useEffect(() => {
    if (mode !== 'full' || !setMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMode('wide');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, setMode]);

  return (
    <aside className={`tools-panel mode-${mode}`} role="complementary" aria-label="Herramientas musicales" style={mode === 'wide' && layout ? { width: layout.width } : undefined}>
      {layout && mode === 'wide' && <Resizer width={layout.width} setWidth={layout.setWidth} />}
      <header className="tools-head">
        {mode === 'full' && (
          <button type="button" className="btn btn-quiet" onClick={() => layout?.setMode('wide')}>
            <Icon name="chevron-left" size={14} /> {hasDocument ? 'Volver a la canción' : 'Volver'}
          </button>
        )}
        <h2><Icon name="circle" size={16} /> {mode === 'full' ? 'Laboratorio de armonía' : 'Explorar armonía'}</h2>
        <span className="tools-modes">
          {layout && (
            <span className="segmented" role="group" aria-label="Tamaño del panel">
              <button type="button" aria-pressed={mode === 'side'} className={mode === 'side' ? 'on' : ''} title="Lateral" aria-label="Panel lateral" onClick={() => layout.setMode('side')}><Icon name="sidebar" size={14} /></button>
              <button type="button" aria-pressed={mode === 'wide'} className={mode === 'wide' ? 'on' : ''} title="Ampliado (arrastrá el borde)" aria-label="Panel ampliado" onClick={() => layout.setMode('wide')}><Icon name="columns" size={14} /></button>
              <button type="button" aria-pressed={mode === 'full'} className={mode === 'full' ? 'on' : ''} title="Laboratorio completo" aria-label="Laboratorio completo" onClick={() => layout.setMode('full')}><Icon name="expand" size={14} /></button>
            </span>
          )}
          <button type="button" className="icon-btn" aria-label="Cerrar herramientas musicales" onClick={onClose}><Icon name="close" size={16} /></button>
        </span>
      </header>
      <p className="muted small tools-note">{hasDocument ? 'Explorar no modifica tu composición. Solo los botones con nombre lo hacen.' : 'Explorá libremente: no hay nada que modificar. Abrí una canción para poder agregar acordes o guardar posiciones.'}</p>
      <Segmented<Tab>
        label="Herramienta"
        value={tab}
        onChange={setTab}
        options={[{ value: 'circle', label: 'Círculo' }, { value: 'chords', label: 'Acordes' }, { value: 'triads', label: 'Tríadas' }, { value: 'modulation', label: 'Modulación' }]}
      />
      <div className="tools-body">
        {tab === 'circle' && (
          <CircleTab selected={selected} setSelected={setSelected} ctx={context} actions={actions} style={style} listen={listen} openChord={(symbol) => { setChord(symbol); setTab('chords'); }} />
        )}
        {tab === 'chords' && (
          <ChordLab chord={chord} setChord={setChord} style={style} tuning={tuning} bpm={bpm} canAddChord={actions.canAddChord} onAddChord={actions.onAddChord} onSaveVoicing={hasDocument ? actions.onSaveVoicing : undefined} />
        )}
        {tab === 'triads' && <TriadLab style={style} tuning={tuning} bpm={bpm} initialRoot={selected.tonic.replace('♯', '#').replace('♭', 'b')} />}
        {tab === 'modulation' && <ModulationTab from={selected} setFrom={setSelected} to={target} setTo={setTarget} actions={actions} style={style} listen={listen} />}
      </div>
    </aside>
  );
}
