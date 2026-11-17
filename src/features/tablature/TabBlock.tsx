import { useEffect, useMemo, useRef, useState } from 'react';
import { tablatureToSequence } from '@/audio/plan';
import { useBlockPlayer } from '@/audio/useBlockPlayer';
import { PlayerBar } from '@/features/notebook/PlayerBar';
import type { TablatureContent, Technique } from '@/core/model';
import { stringName } from '@/core/music';
import { usePref } from '@/core/prefs';
import { Icon } from '@/components/ui/Icon';
import { Menu } from '@/components/ui/Popover';
import { Segmented } from '@/components/ui/Segmented';
import { useToast } from '@/components/ui/toast-context';
import { FretboardCanvas, type Marker } from '@/features/fretboard/FretboardCanvas';
import { enterDigit } from '@/features/tablature/entry';
import {
  advanceCursor,
  annotateColumn,
  appendNote,
  autoLink,
  copyTabFragment,
  ensureColumn,
  insertColumn,
  pasteTabFragment,
  removeColumn,
  setFret,
  toggleChordNote,
  toggleTechnique,
  type LinkFamily,
  type TabCursor,
} from '@/features/tablature/operations';
import { readTabClipboard, useTabClipboard, writeTabClipboard } from '@/features/tablature/tab-clipboard';

type Change = (update: (content: TablatureContent) => TablatureContent) => void;
type Pending = { column: number; string: number; value: number } | null;

const MAX_FRET = 24;
const linkGlyph = { 'hammer-on': 'h', 'pull-off': 'p', 'slide-up': '/', 'slide-down': '\\' } as const;
const linkName = {
  'hammer-on': 'Hammer-on',
  'pull-off': 'Pull-off',
  'slide-up': 'Slide ascendente',
  'slide-down': 'Slide descendente',
} as const;
const fretChoices = [5, 12, 15, 24];

/**
 * A temporal sequence: each column is one event, written in reading order.
 * It can be written with the keyboard or by clicking the neck (melody: one click, one event;
 * chord: several strings in the same event).
 */
export function TabBlock({
  blockId,
  content,
  onChange,
  readOnly = false,
  active = true,
  onActivate,
}: {
  blockId: string;
  content: TablatureContent;
  onChange: Change;
  readOnly?: boolean;
  active?: boolean;
  onActivate?: () => void;
}) {
  const toast = useToast();
  const sequence = useMemo(() => tablatureToSequence(content), [content]);
  const player = useBlockPlayer({ owner: blockId, sequence, blockBpm: content.bpm, instrument: content.instrument });
  const [selected, setSelected] = useState<TabCursor>({ column: 0, string: 0 });
  const programmatic = useRef(false);
  // Selection is anchor → cursor: the anchor stays put while Shift+arrows move the cursor.
  const [anchor, setAnchor] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [rejected, setRejected] = useState(false);
  const [labeling, setLabeling] = useState(false);
  const [width, setWidth] = useState(960);
  const [input, setInput] = usePref<'keyboard' | 'fretboard'>('tab-input', 'keyboard');
  const [entry, setEntry] = usePref<'melody' | 'chord'>('tab-entry', 'melody');
  const [autoAdvance, setAutoAdvance] = usePref('tab-auto-advance', true);
  const [autoWrap, setAutoWrap] = usePref('tab-auto-wrap', true);
  const [visibleFrets, setVisibleFrets] = usePref('tab-frets', 12);
  const clipboard = useTabClipboard();
  const sheet = useRef<HTMLDivElement>(null);
  const cellId = (column: number, string: number) => `tab-${blockId}-${column}-${string}`;
  const dockOpen = input === 'fretboard' && !readOnly;

  useEffect(() => {
    const element = sheet.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([item]) => setWidth(item.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const unit = 15 * content.zoom;
  const perRow = autoWrap
    ? Math.max(4, Math.min(48, Math.floor((width - 3.4 * unit) / (2.5 * unit))))
    : content.wrapAfter;
  const systems = useMemo(() => {
    const rows: Array<{ start: number; columns: typeof content.columns }> = [];
    let row: typeof content.columns = [];
    let start = 0;
    content.columns.forEach((column, index) => {
      if (row.length && (row.length >= perRow || column.lineBreak)) {
        rows.push({ start, columns: row });
        row = [];
        start = index;
      }
      row.push(column);
    });
    if (row.length) rows.push({ start, columns: row });
    return rows;
  }, [content, perRow]);

  const range = {
    start: Math.min(selected.column, anchor ?? selected.column),
    end: Math.max(selected.column, anchor ?? selected.column),
  };
  const selectedCell = content.columns[selected.column]?.cells[selected.string];
  const selectedTechniques = selectedCell?.techniques ?? [];
  const links = content.techniqueLinks ?? [];
  const columnIndex = useMemo(() => new Map(content.columns.map((column, index) => [column.id, index])), [content.columns]);

  // Keys are always routed by the logical cursor, never by whichever input still owns DOM focus,
  // so fast typing cannot land in the wrong cell while focus catches up.
  function focusCell(column: number, string: number) {
    const move = () => {
      const element = document.getElementById(cellId(column, string));
      if (!element) return false;
      programmatic.current = true;
      element.focus();
      programmatic.current = false;
      return true;
    };
    if (!move()) requestAnimationFrame(move);
  }
  function go(next: TabCursor, extend = false) {
    setPending(null);
    setAnchor(extend ? (anchor ?? selected.column) : null);
    setSelected(next);
    focusCell(next.column, next.string);
  }
  function advance(column: number, string: number) {
    if (column + 1 >= content.columns.length) onChange((current) => ensureColumn(current, column + 1));
    go({ column: column + 1, string });
  }
  function flashRejected() {
    setRejected(true);
    window.setTimeout(() => setRejected(false), 280);
  }
  function link(family: LinkFamily) {
    const result = autoLink(content, selected, family);
    if (result.outcome === 'linked' || result.outcome === 'unlinked') onChange(() => result.tab);
    else
      toast.show(
        result.outcome === 'no-note'
          ? 'Elegí primero una nota para enlazarla.'
          : result.outcome === 'no-target'
            ? 'No hay otra nota a la derecha en esta cuerda para enlazar.'
            : 'Las dos notas suenan igual: no hay ligado ni slide.',
      );
  }
  function tech(technique: Technique) {
    onChange((current) => toggleTechnique(current, selected.column, selected.string, technique));
  }
  function cycleBend() {
    onChange((current) => {
      const has = (name: Technique) =>
        current.columns[selected.column]?.cells[selected.string]?.techniques?.includes(name);
      if (has('bend-half')) {
        return toggleTechnique(toggleTechnique(current, selected.column, selected.string, 'bend-half'), selected.column, selected.string, 'bend-full');
      }
      if (has('bend-full')) return toggleTechnique(current, selected.column, selected.string, 'bend-full');
      return toggleTechnique(current, selected.column, selected.string, 'bend-half');
    });
  }
  function copySelection() {
    writeTabClipboard(copyTabFragment(content, range.start, range.end));
  }
  function pasteFragment() {
    const fragment = readTabClipboard();
    if (!fragment) return;
    onChange((current) => pasteTabFragment(current, range.end + 1, fragment));
  }
  function cutSelection() {
    copySelection();
    onChange((current) => {
      let next = current;
      for (let index = range.end; index >= range.start; index -= 1) next = removeColumn(next, index);
      return next;
    });
    go({ column: Math.max(0, range.start - 1), string: selected.string });
  }
  function duplicateSelection() {
    const fragment = copyTabFragment(content, range.start, range.end);
    onChange((current) => pasteTabFragment(current, range.end + 1, fragment));
  }
  function insertEvent() {
    onChange((current) => insertColumn(current, selected.column));
    go({ column: selected.column + 1, string: selected.string });
  }
  function deleteEvent() {
    onChange((current) => removeColumn(current, selected.column));
    go({ column: Math.max(0, Math.min(selected.column, content.columns.length - 2)), string: selected.string });
  }

  function onCellKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const { column, string } = selected;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (modifier) {
      const lower = key.toLowerCase();
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      if (lower === 'c') run(copySelection);
      else if (lower === 'x') run(cutSelection);
      else if (lower === 'v') run(pasteFragment);
      else if (lower === 'd') run(duplicateSelection);
      else if (key === 'Enter') run(insertEvent);
      else if (key === 'Backspace') run(deleteEvent);
      return; // undo and redo are handled by the document
    }
    if (/^[0-9]$/.test(key)) {
      event.preventDefault();
      const here = pending && pending.column === column && pending.string === string ? pending.value : null;
      const result = enterDigit(here, Number(key), MAX_FRET);
      if (result.kind === 'rejected') return flashRejected();
      onChange((current) => setFret(current, column, string, result.value));
      if (result.pending) setPending({ column, string, value: result.value });
      else {
        setPending(null);
        if (autoAdvance) advance(column, string);
      }
      return;
    }
    switch (key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        advance(column, string);
        return;
      case 'Tab':
        event.preventDefault();
        if (event.shiftKey) go({ column: Math.max(0, column - 1), string });
        else advance(column, string);
        return;
      case 'ArrowRight':
        event.preventDefault();
        if (event.shiftKey) go({ column: Math.min(content.columns.length - 1, column + 1), string }, true);
        else if (column + 1 >= content.columns.length) advance(column, string);
        else go({ column: column + 1, string });
        return;
      case 'ArrowLeft':
        event.preventDefault();
        go({ column: Math.max(0, column - 1), string }, event.shiftKey);
        return;
      case 'ArrowDown':
        event.preventDefault();
        go({ column, string: Math.min(content.tuning.length - 1, string + 1) });
        return;
      case 'ArrowUp':
        event.preventDefault();
        go({ column, string: Math.max(0, string - 1) });
        return;
      case 'Home':
        event.preventDefault();
        go({ column: 0, string });
        return;
      case 'End':
        event.preventDefault();
        go({ column: content.columns.length - 1, string });
        return;
      case 'Delete':
        event.preventDefault();
        setPending(null);
        onChange((current) => setFret(current, column, string, undefined));
        return;
      case 'Backspace':
        event.preventDefault();
        if (pending || content.columns[column].cells[string].fret !== undefined) {
          setPending(null);
          onChange((current) => setFret(current, column, string, undefined));
        } else go({ column: Math.max(0, column - 1), string });
        return;
      case 'h':
      case 'p':
        event.preventDefault();
        return link('legato');
      case '/':
      case '\\':
        event.preventDefault();
        return link('slide');
      case 'b':
        event.preventDefault();
        return cycleBend();
      case '~':
      case 'v':
        event.preventDefault();
        return tech('vibrato');
      case 'x':
        event.preventDefault();
        return tech('mute');
      default:
        if (key.length === 1) event.preventDefault(); // nothing else is typed into a fret
    }
  }

  function pickFromNeck(string: number, fret: number) {
    if (entry === 'melody') {
      const result = appendNote(content, selected, string, fret);
      onChange(() => result.tab);
      setSelected(result.cursor);
    } else {
      onChange((current) => toggleChordNote(current, selected.column, string, fret));
      setSelected({ column: selected.column, string });
    }
    setAnchor(null);
    setPending(null);
    requestAnimationFrame(() =>
      document.getElementById(cellId(entry === 'melody' ? Math.min(content.columns.length, selected.column + 1) : selected.column, string))?.scrollIntoView({ block: 'nearest' }),
    );
  }
  function nextEvent() {
    const result = advanceCursor(content, selected);
    onChange(() => result.tab);
    setSelected(result.cursor);
  }

  const activeMarkers: Marker[] = content.columns[selected.column]
    ? content.columns[selected.column].cells.flatMap((cell, string): Marker[] =>
        cell.fret === undefined ? [] : [{ string, fret: cell.fret, label: String(cell.fret), tone: 'active' }],
      )
    : [];
  const lastLabel = content.columns[selected.column]?.section ?? '';

  const step = content.stepBeats && content.stepBeats > 0 ? content.stepBeats : 1;
  const hasSound = sequence.events.length > 0;

  return (
    <div className="tab-block" onFocusCapture={onActivate} onPointerDownCapture={onActivate}>
      <div className="player-row">
        <PlayerBar
          player={player}
          label="tablatura"
          disabled={!hasSound}
          emptyHint="Escribí alguna nota para poder escucharla"
          onBpm={readOnly ? undefined : (bpm) => onChange((current) => ({ ...current, bpm: Math.max(30, Math.min(280, Math.round(bpm))) }))}
          onInstrument={readOnly ? undefined : (instrument) => onChange((current) => ({ ...current, instrument }))}
        />
        {!readOnly && (
          <>
            <label className="field inline compact">
              <span>Cada paso dura</span>
              <select
                aria-label="Duración de cada paso"
                value={step}
                onChange={(event) => onChange((current) => ({ ...current, stepBeats: Number(event.target.value) }))}
              >
                <option value={0.5}>½ pulso</option>
                <option value={1}>1 pulso</option>
                <option value={2}>2 pulsos</option>
              </select>
            </label>
            <button type="button" className="btn btn-ghost" disabled={!hasSound} onClick={() => void player.play(selected.column * step)}>
              Desde la selección
            </button>
          </>
        )}
      </div>
      {!readOnly && (
        <div className={`block-bar nb-chrome${active ? '' : ' dim'}`}>
          <Segmented<'keyboard' | 'fretboard'>
            label="Cómo escribir las notas"
            value={input}
            onChange={setInput}
            options={[
              { value: 'keyboard', label: 'Teclado', title: 'Escribir números en la tablatura' },
              { value: 'fretboard', label: 'Mástil', title: 'Hacer clic sobre el mástil' },
            ]}
          />
          <div className="tech-group" role="group" aria-label="Técnicas de la nota seleccionada">
            <button
              type="button"
              className="tech"
              aria-label="Ligado: hammer-on o pull-off"
              title="Ligado (h / p): une con la siguiente nota de la cuerda"
              aria-pressed={links.some((item) => item.from.columnId === content.columns[selected.column]?.id && item.from.string === selected.string && (item.technique === 'hammer-on' || item.technique === 'pull-off'))}
              onClick={() => link('legato')}
            >
              h/p
            </button>
            <button
              type="button"
              className="tech"
              aria-label="Slide ascendente o descendente"
              title="Slide (/ o \): une con la siguiente nota de la cuerda"
              aria-pressed={links.some((item) => item.from.columnId === content.columns[selected.column]?.id && item.from.string === selected.string && (item.technique === 'slide-up' || item.technique === 'slide-down'))}
              onClick={() => link('slide')}
            >
              / \
            </button>
            <button type="button" className="tech" aria-label="Bend" title="Bend (b): medio tono, tono completo, nada" aria-pressed={selectedTechniques.includes('bend-half') || selectedTechniques.includes('bend-full')} onClick={cycleBend}>
              {selectedTechniques.includes('bend-full') ? 'b 1' : 'b ½'}
            </button>
            <button type="button" className="tech" aria-label="Vibrato" title="Vibrato (~)" aria-pressed={selectedTechniques.includes('vibrato')} onClick={() => tech('vibrato')}>
              ~
            </button>
            <button type="button" className="tech" aria-label="Nota apagada" title="Nota apagada (x)" aria-pressed={selectedTechniques.includes('mute')} onClick={() => tech('mute')}>
              x
            </button>
          </div>
          <span className="spacer" />
          <button type="button" className="icon-btn" aria-label="Reducir zoom de la tablatura" onClick={() => onChange((current) => ({ ...current, zoom: Math.max(0.7, Number((current.zoom - 0.1).toFixed(1))) }))}>
            <Icon name="minus" size={14} />
          </button>
          <span className="zoom-read" aria-hidden="true">
            {Math.round(content.zoom * 100)}%
          </span>
          <button type="button" className="icon-btn" aria-label="Aumentar zoom de la tablatura" onClick={() => onChange((current) => ({ ...current, zoom: Math.min(1.8, Number((current.zoom + 0.1).toFixed(1))) }))}>
            <Icon name="plus" size={14} />
          </button>
          <Menu
            label="Más opciones de la tablatura"
            align="end"
            triggerClassName="icon-btn"
            trigger={<Icon name="more" />}
            items={[
              { label: 'Insertar evento', icon: 'plus', hint: 'Ctrl+Enter', onSelect: insertEvent },
              { label: 'Eliminar evento', icon: 'trash', hint: 'Ctrl+⌫', onSelect: deleteEvent, disabled: content.columns.length <= 1 },
              { label: 'Salto de línea aquí', onSelect: () => onChange((current) => ({ ...current, columns: current.columns.map((column, index) => (index === selected.column ? { ...column, lineBreak: !column.lineBreak } : column)) })) },
              { label: 'Rótulo del evento…', icon: 'pencil', onSelect: () => setLabeling(true) },
              { separator: true },
              { label: 'Copiar', icon: 'copy', hint: 'Ctrl+C', onSelect: copySelection },
              { label: 'Cortar', hint: 'Ctrl+X', onSelect: cutSelection },
              { label: 'Pegar', hint: 'Ctrl+V', onSelect: pasteFragment, disabled: !clipboard },
              { label: 'Duplicar selección', hint: 'Ctrl+D', onSelect: duplicateSelection },
              { separator: true },
              { label: 'Avanzar solo al escribir una nota', checked: autoAdvance, onSelect: () => setAutoAdvance(!autoAdvance) },
              { label: 'Ajustar renglones al ancho', checked: autoWrap, onSelect: () => setAutoWrap(!autoWrap) },
            ]}
          />
        </div>
      )}
      {labeling && !readOnly && (
        <form
          className="label-row nb-chrome"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('label');
            onChange((current) => annotateColumn(current, selected.column, String(value ?? '')));
            setLabeling(false);
          }}
        >
          <label>
            Rótulo del evento {selected.column + 1}
            <input name="label" autoFocus defaultValue={lastLabel} placeholder="Am, let ring, Estribillo…" />
          </label>
          <button type="submit" className="btn btn-primary">
            Guardar
          </button>
          <button type="button" className="btn" onClick={() => setLabeling(false)}>
            Cancelar
          </button>
        </form>
      )}

      <div ref={sheet} className={`tb-sheet${rejected ? ' rejected' : ''}`} style={{ ['--tb-unit' as string]: `${unit}px` }} role="group" aria-label="Tablatura">
        {systems.map((system, systemIndex) => (
          <div
            key={system.columns[0].id}
            className="tb-system"
            data-export-unit
            role="group"
            aria-label={`Renglón ${systemIndex + 1}`}
            style={{ gridTemplateColumns: `2.4em repeat(${system.columns.length}, minmax(2.5em, 1fr))` }}
          >
            {content.tuning.map((open, string) => (
              <div key={string} className="tb-row" role="presentation" style={{ display: 'contents' }}>
                <div className="tb-name" aria-hidden="true">
                  {stringName(open, false)}
                </div>
                {system.columns.map((column, local) => {
                  const col = system.start + local;
                  const cell = column.cells[string];
                  const isSelected = !readOnly && selected.column === col && selected.string === string;
                  const inRange = !readOnly && anchor !== null && col >= range.start && col <= range.end;
                  const inEvent = !readOnly && selected.column === col && active;
                  const muted = cell.techniques?.includes('mute');
                  const shown = cell.fret !== undefined ? String(cell.fret) : muted ? 'x' : '';
                  const marks = (cell.techniques ?? []).filter((item) => item === 'bend-half' || item === 'bend-full' || item === 'vibrato');
                  const outgoing = links.filter((item) => item.from.columnId === column.id && item.from.string === string);
                  return (
                    <div
                      key={`${column.id}-${string}`}
                      className={`tb-cell${player.activeId === column.id ? ' playing' : ''}${isSelected ? ' sel' : ''}${inRange ? ' range' : ''}${inEvent ? ' event' : ''}${shown ? ' has' : ''}${isSelected && pending ? ' pending' : ''}`}
                    >
                      {string === 0 && column.section && <span className="tb-label">{column.section}</span>}
                      {readOnly ? (
                        <span className="tb-fret static">{shown}</span>
                      ) : (
                        <input
                          id={cellId(col, string)}
                          className="tb-fret"
                          aria-label={`Cuerda ${string + 1}, columna ${col + 1}`}
                          inputMode="numeric"
                          autoComplete="off"
                          value={shown}
                          onChange={(event) => {
                            // Fallback for input that produces no key events (IME, paste, some touch keyboards).
                            const digits = event.target.value.replace(/\D/g, '');
                            const value = Number(digits.slice(-2));
                            if (digits && value <= MAX_FRET) onChange((current) => setFret(current, col, string, value));
                          }}
                          onFocus={(event) => {
                            event.currentTarget.select();
                            if (programmatic.current) return;
                            setSelected({ column: col, string });
                            if (!pending || pending.column !== col || pending.string !== string) setPending(null);
                          }}
                          onMouseDown={(event) => setAnchor(event.shiftKey ? (anchor ?? selected.column) : null)}
                          onKeyDown={onCellKeyDown}
                        />
                      )}
                      {marks.length > 0 && (
                        <span className="tb-mark" aria-hidden="true">
                          {marks.map((item) => (item === 'vibrato' ? '~' : item === 'bend-half' ? '↑½' : '↑1')).join(' ')}
                        </span>
                      )}
                      {outgoing.map((item) => (
                        <span
                          key={item.id}
                          className="tb-link"
                          data-testid={`tech-link-${item.id}`}
                          role="img"
                          aria-label={`${linkName[item.technique]} de la columna ${col + 1} a la ${(columnIndex.get(item.to.columnId) ?? 0) + 1}`}
                        >
                          {linkGlyph[item.technique]}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>

      {dockOpen && (
        <div className="tb-dock nb-chrome" role="group" aria-label="Entrada por el mástil">
          <div className="dock-bar">
            <Segmented<'melody' | 'chord'>
              label="Qué escribe cada clic"
              value={entry}
              onChange={setEntry}
              options={[
                { value: 'melody', label: 'Melodía', title: 'Cada clic es la nota siguiente' },
                { value: 'chord', label: 'Acorde', title: 'Varias cuerdas en el mismo evento; también sirve para corregir una nota' },
              ]}
            />
            <span className="dock-target" aria-live="polite">
              {entry === 'melody' ? 'Cada clic es una nota nueva' : `Evento ${selected.column + 1}: una nota por cuerda`}
            </span>
            <span className="spacer" />
            {entry === 'chord' && (
              <button type="button" className="btn" onClick={nextEvent}>
                Siguiente evento <Icon name="chevron-right" size={14} />
              </button>
            )}
            <Segmented<string>
              label="Trastes visibles en el mástil"
              value={String(visibleFrets)}
              onChange={(value) => setVisibleFrets(Number(value))}
              options={fretChoices.map((value) => ({ value: String(value), label: String(value), ariaLabel: `${value} trastes` }))}
            />
          </div>
          <FretboardCanvas
            tuning={content.tuning}
            latin={false}
            from={0}
            to={visibleFrets}
            markers={activeMarkers}
            onPick={pickFromNeck}
            label="Mástil para escribir la tablatura"
            testId="tab-neck"
            maxCell={visibleFrets <= 5 ? 110 : 80}
          />
        </div>
      )}
    </div>
  );
}
