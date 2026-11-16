import { useMemo, useState } from 'react';
import type { FretNote, FretPosition, FretboardContent } from '@/core/model';
import { intervalName, noteName, pitchClassAt, SCALE_PATTERNS, type ScaleName } from '@/core/music';
import { Icon } from '@/components/ui/Icon';
import { Menu, Popover } from '@/components/ui/Popover';
import { Segmented } from '@/components/ui/Segmented';
import { FretboardCanvas, type Marker } from '@/features/fretboard/FretboardCanvas';
import {
  addPosition,
  applyNotes,
  clearPosition,
  duplicateSpatialPosition,
  generatedScaleNotes,
  noteKey,
  removeSpatialPosition,
  setNoteFinger,
  setRange,
  toggleNoteIn,
  updatePosition,
  visibleRange,
} from '@/features/fretboard/operations';

type View = 'single' | 'compare' | 'all';
type Show = 'notes' | 'intervals' | 'fingers' | 'positions';
type Finger = 1 | 2 | 3 | 4 | null;
type Change = (update: (content: FretboardContent) => FretboardContent) => void;

const fretPresets = [5, 12, 15, 24];

function cropped(position: FretPosition, from: number, to: number) {
  if (!position.notes.length) return { from, to };
  const frets = position.notes.map((note) => note.fret);
  const low = Math.min(...frets) - 1;
  const lo = low <= 1 ? 0 : low;
  const hi = Math.min(to, Math.max(...frets) + 1);
  return { from: Math.max(from, lo), to: Math.max(hi, Math.min(to, Math.max(from, lo) + 4)) };
}

/**
 * A spatial map: points on the neck, any number per string, no order and no time.
 * Several positions can live in the same block and be viewed one by one, side by side, or all together.
 */
export function MapBlock({
  content,
  onChange,
  readOnly = false,
}: {
  content: FretboardContent;
  onChange: Change;
  readOnly?: boolean;
}) {
  const [activeId, setActiveId] = useState(content.selectedPositionId);
  // Structural changes (add, duplicate, delete) move the selection; switching tabs never writes to the document.
  const [seenSelected, setSeenSelected] = useState(content.selectedPositionId);
  if (seenSelected !== content.selectedPositionId) {
    setSeenSelected(content.selectedPositionId);
    setActiveId(content.selectedPositionId);
  }
  const [view, setView] = useState<View>('single');
  const [show, setShow] = useState<Show>(content.notation === 'intervals' ? 'intervals' : 'notes');
  const [finger, setFinger] = useState<Finger>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [scale, setScale] = useState<ScaleName>('Mayor');
  const active = content.positions.find((position) => position.id === activeId) ?? content.positions[0];
  const range = visibleRange(content);
  const rootName = noteName(content.root, 0, content.latin);

  const owners = useMemo(() => {
    const map = new Map<string, number>();
    content.positions.forEach((position, index) =>
      position.notes.forEach((note) => {
        if (!map.has(noteKey(note))) map.set(noteKey(note), index);
      }),
    );
    return map;
  }, [content.positions]);

  function labelFor(note: FretNote, positionIndex: number) {
    const pitch = pitchClassAt(content.tuning[note.string], note.fret);
    if (show === 'fingers') return note.finger ? String(note.finger) : '';
    if (show === 'positions') return String(positionIndex + 1);
    return show === 'intervals' ? intervalName(pitch, content.root) : noteName(pitch, 0, content.latin);
  }
  function markersFor(position: FretPosition, index: number, grouped: boolean): Marker[] {
    return position.notes.map((note) => ({
      string: note.string,
      fret: note.fret,
      label: labelFor(note, index),
      tone: pitchClassAt(content.tuning[note.string], note.fret) === content.root ? 'root' : 'note',
      group: grouped ? index : undefined,
    }));
  }

  function pick(positionId: string) {
    return (string: number, fret: number) => {
      if (readOnly) return;
      const position = content.positions.find((item) => item.id === positionId);
      const existing = position?.notes.find((note) => note.string === string && note.fret === fret);
      onChange((current) => {
        if (finger && existing) {
          return existing.finger === finger
            ? toggleNoteIn(current, positionId, string, fret)
            : setNoteFinger(current, positionId, string, fret, finger);
        }
        return toggleNoteIn(current, positionId, string, fret, finger ?? undefined);
      });
    };
  }
  function choose(id: string) {
    setActiveId(id);
  }
  function addNewPosition() {
    onChange((current) => addPosition(current));
    setView('single');
  }
  function chooseShow(value: Show) {
    setShow(value);
    if ((value === 'notes' || value === 'intervals') && !readOnly) {
      onChange((current) => ({ ...current, notation: value }));
    }
    if (value !== 'fingers') setFinger(null);
  }
  const proposal = useMemo(() => generatedScaleNotes(content, scale), [content, scale]);
  const showOptions = [
    { value: 'notes' as const, label: 'Notas' },
    { value: 'intervals' as const, label: 'Intervalos' },
    ...(readOnly ? [] : [{ value: 'fingers' as const, label: 'Dedos' }]),
    ...(view === 'all' ? [{ value: 'positions' as const, label: 'Posiciones' }] : []),
  ];

  const singleMarkers: Marker[] = [
    // Other positions' notes show as faint outlines while editing; reading keeps only what matters.
    ...(readOnly
      ? []
      : content.baseNotes
          .filter((note) => !active.notes.some((own) => noteKey(own) === noteKey(note)))
          .map((note): Marker => ({ string: note.string, fret: note.fret, tone: 'ghost' }))),
    ...markersFor(active, content.positions.indexOf(active), false),
  ];
  const allMarkers: Marker[] = content.baseNotes.map((note) => {
    const index = owners.get(noteKey(note)) ?? 0;
    return {
      string: note.string,
      fret: note.fret,
      label: labelFor(note, index),
      tone: pitchClassAt(content.tuning[note.string], note.fret) === content.root ? 'root' : 'note',
      group: index,
    };
  });

  return (
    <div className="map-block">
      <div className="block-bar">
        <div
          className="pos-tabs"
          role="tablist"
          aria-label="Posiciones"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            const index = content.positions.findIndex((position) => position.id === active.id);
            const next = content.positions[index + (event.key === 'ArrowRight' ? 1 : -1)];
            if (next) {
              event.preventDefault();
              choose(next.id);
              setView('single');
              requestAnimationFrame(() => document.getElementById(`pos-tab-${next.id}`)?.focus());
            }
          }}
        >
          {content.positions.map((position) =>
            renaming === position.id ? (
              <input
                key={position.id}
                className="pos-rename"
                aria-label="Nombre de la posición"
                autoFocus
                defaultValue={position.name}
                onBlur={(event) => {
                  onChange((current) => updatePosition(current, position.id, { name: event.target.value.trim() || position.name }));
                  setRenaming(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
                }}
              />
            ) : (
              <button
                key={position.id}
                id={`pos-tab-${position.id}`}
                type="button"
                role="tab"
                aria-selected={position.id === active.id && view === 'single'}
                tabIndex={position.id === active.id ? 0 : -1}
                className={position.id === active.id && view === 'single' ? 'on' : ''}
                onClick={() => {
                  choose(position.id);
                  setView('single');
                }}
                onDoubleClick={() => !readOnly && setRenaming(position.id)}
              >
                {position.name}
              </button>
            ),
          )}
          {!readOnly && (
            <button type="button" className="pos-add" aria-label="Agregar posición" title="Agregar posición" onClick={addNewPosition}>
              <Icon name="plus" size={14} />
            </button>
          )}
        </div>
        <Segmented<View>
          label="Vista del mapa"
          value={view}
          onChange={setView}
          options={[
            { value: 'single', label: 'Individual' },
            { value: 'compare', label: 'Conjunta', title: 'Todas las posiciones, una al lado de otra' },
            { value: 'all', label: 'Completa', title: 'Todas las notas sobre un solo mástil' },
          ]}
        />
      </div>

      <div className="block-bar quiet">
        {readOnly ? (
          <span className="chip-static">
            Tónica <strong>{rootName}</strong>
          </span>
        ) : (
          <Menu
            label={`Tónica: ${rootName}`}
            triggerClassName="chip"
            trigger={
              <>
                Tónica <strong>{rootName}</strong>
                <Icon name="chevron-down" size={12} />
              </>
            }
            items={Array.from({ length: 12 }, (_, root) => ({
              label: noteName(root, 0, content.latin),
              checked: root === content.root,
              onSelect: () => onChange((current) => ({ ...current, root })),
            }))}
          />
        )}
        <Segmented<Show> label="Qué mostrar en cada nota" value={show} onChange={chooseShow} options={showOptions} />
        {show === 'fingers' && !readOnly && (
          <div className="finger-tool" role="group" aria-label="Dedo para las próximas notas">
            {([null, 1, 2, 3, 4] as const).map((value) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={finger === value}
                aria-label={value ? `Dedo ${value}` : 'Sin dedo'}
                className={finger === value ? 'on' : ''}
                onClick={() => setFinger(value)}
              >
                {value ?? '—'}
              </button>
            ))}
          </div>
        )}
        {!readOnly && (
          <>
            <Popover
              label="Trastes visibles"
              triggerClassName="chip"
              trigger={
                <>
                  {range.from > 0 ? `Trastes ${range.from}–${content.maxFret}` : `${content.maxFret} trastes`}
                  <Icon name="chevron-down" size={12} />
                </>
              }
            >
              {() => (
                <div className="pop-stack">
                  <Segmented<string>
                    label="Cantidad de trastes"
                    value={range.from === 0 ? String(content.maxFret) : ''}
                    onChange={(value) => onChange((current) => setRange(current, 0, Number(value)))}
                    options={fretPresets.map((value) => ({ value: String(value), label: String(value) }))}
                  />
                  <label className="field inline">
                    <span>Hasta</span>
                    <input
                      type="number"
                      aria-label="Último traste"
                      min={1}
                      max={24}
                      value={content.maxFret}
                      onChange={(event) => onChange((current) => setRange(current, current.minFret ?? 0, Number(event.target.value)))}
                    />
                  </label>
                  <label className="field inline">
                    <span>Desde</span>
                    <input
                      type="number"
                      aria-label="Primer traste"
                      min={0}
                      max={Math.max(0, content.maxFret - 1)}
                      value={range.from}
                      onChange={(event) => onChange((current) => setRange(current, Number(event.target.value), current.maxFret))}
                    />
                  </label>
                </div>
              )}
            </Popover>
            <Popover
              label="Generar escala"
              triggerClassName="chip"
              trigger={
                <>
                  Escala <Icon name="chevron-down" size={12} />
                </>
              }
            >
              {(close) => (
                <div className="pop-stack">
                  <label className="field">
                    <span>Escala sobre {rootName}</span>
                    <select aria-label="Tipo de escala" value={scale} onChange={(event) => setScale(event.target.value as ScaleName)}>
                      {Object.keys(SCALE_PATTERNS).map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <p className="muted small">
                    Propone {proposal.length} notas dentro de los trastes visibles para «{active.name}». Tus marcas no se tocan al
                    agregar.
                  </p>
                  <div className="pop-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        onChange((current) => applyNotes(current, active.id, generatedScaleNotes(current, scale), 'merge'));
                        close();
                      }}
                    >
                      Agregar a la posición
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        onChange((current) => applyNotes(current, active.id, generatedScaleNotes(current, scale), 'replace'));
                        close();
                      }}
                    >
                      Reemplazar
                    </button>
                  </div>
                </div>
              )}
            </Popover>
            <Menu
              label="Más opciones del mapa"
              triggerClassName="icon-btn"
              align="end"
              trigger={<Icon name="more" />}
              items={[
                { label: 'Renombrar posición', icon: 'pencil', onSelect: () => setRenaming(active.id) },
                {
                  label: 'Duplicar posición',
                  icon: 'copy',
                  onSelect: () => {
                    onChange((current) => duplicateSpatialPosition(current, active.id));
                    setView('single');
                  },
                },
                { label: 'Vaciar posición', icon: 'close', onSelect: () => onChange((current) => clearPosition(current, active.id)) },
                {
                  label: 'Eliminar posición',
                  icon: 'trash',
                  danger: true,
                  disabled: content.positions.length <= 1,
                  onSelect: () => onChange((current) => removeSpatialPosition(current, active.id)),
                },
                { separator: true },
                { label: 'Nombres: Do Re Mi', checked: content.latin, onSelect: () => onChange((current) => ({ ...current, latin: true })) },
                { label: 'Nombres: C D E', checked: !content.latin, onSelect: () => onChange((current) => ({ ...current, latin: false })) },
              ]}
            />
          </>
        )}
      </div>

      {view === 'single' && (
        <>
          <FretboardCanvas
            tuning={content.tuning}
            latin={content.latin}
            from={range.from}
            to={range.to}
            markers={singleMarkers}
            onPick={readOnly ? undefined : pick(active.id)}
            label={`Mástil de ${active.name}`}
            testId="map-canvas"
          />
          {(!readOnly || active.comments) && (
            <input
              className="note-input"
              aria-label="Nota sobre esta posición"
              placeholder="Anotá algo sobre esta posición…"
              readOnly={readOnly}
              value={active.comments ?? ''}
              onChange={(event) => onChange((current) => updatePosition(current, active.id, { comments: event.target.value }))}
            />
          )}
        </>
      )}

      {view === 'compare' && (
        <div className="compare" data-testid="map-compare">
          {content.positions.map((position, index) => {
            const window = cropped(position, range.from, range.to);
            return (
              <section key={position.id} className="compare-item" aria-label={position.name}>
                <h4>
                  <button
                    type="button"
                    className="btn btn-link"
                    onClick={() => {
                      choose(position.id);
                      setView('single');
                    }}
                  >
                    {position.name}
                  </button>
                  <span className="muted small">{position.notes.length} notas</span>
                </h4>
                <FretboardCanvas
                  tuning={content.tuning}
                  latin={content.latin}
                  from={window.from}
                  to={window.to}
                  markers={markersFor(position, index, true)}
                  onPick={readOnly ? undefined : pick(position.id)}
                  label={`Mástil de ${position.name}`}
                  testId={`compare-${index}`}
                  maxCell={64}
                  minCell={28}
                />
              </section>
            );
          })}
        </div>
      )}

      {view === 'all' && (
        <>
          <FretboardCanvas
            tuning={content.tuning}
            latin={content.latin}
            from={range.from}
            to={range.to}
            markers={allMarkers}
            label="Mástil con todas las posiciones"
            testId="map-all"
          />
          <ul className="legend" aria-label="Posiciones">
            {content.positions.map((position, index) => (
              <li key={position.id}>
                <i className={`swatch g${index % 6}`} aria-hidden="true">
                  {index + 1}
                </i>
                {position.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
