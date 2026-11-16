import { useMemo, useState } from 'react';
import { EMPHASIS_ROLES, emphasisOf, type Emphasis, type Role } from '@/core/harmony';
import type { FretboardContent, FretboardView, FretPosition } from '@/core/model';
import { noteName, SCALE_PATTERNS, type ScaleName } from '@/core/music';
import { Icon } from '@/components/ui/Icon';
import { Menu, Popover } from '@/components/ui/Popover';
import { Segmented } from '@/components/ui/Segmented';
import { FretboardCanvas } from '@/features/fretboard/FretboardCanvas';
import { HarmonyLegend } from '@/features/fretboard/HarmonyLegend';
import {
  legendLabel,
  markersForAll,
  markersForPosition,
  rolesPresent,
  type ShowMode,
} from '@/features/fretboard/map-markers';
import {
  addPosition,
  applyNotes,
  clearPosition,
  duplicateSpatialPosition,
  generatedScaleNotes,
  removeSpatialPosition,
  resolvedView,
  setNoteFinger,
  setRange,
  setView,
  toggleNoteIn,
  updatePosition,
  visibleRange,
} from '@/features/fretboard/operations';

type View = 'single' | 'compare' | 'all';
type Finger = 1 | 2 | 3 | 4 | null;
type Change = (update: (content: FretboardContent) => FretboardContent) => void;
type Local = { show: 'fingers' | 'positions' | null; view: Partial<FretboardView> };

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
 * A spatial map: points on the neck, any number per string, no order and no time. It can be read as
 * notes, intervals or both, with the harmonic functions in the same four colors everywhere. Those
 * reading choices are saved with the map but never add, remove or move a note. When the block is only
 * being read (practice), the choices stay local and nothing is written.
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
  const [view, setViewMode] = useState<View>('single');
  const [finger, setFinger] = useState<Finger>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [scale, setScale] = useState<ScaleName>('Mayor');
  const [local, setLocal] = useState<Local>({ show: null, view: {} });
  const active = content.positions.find((position) => position.id === activeId) ?? content.positions[0];
  const range = visibleRange(content);
  const rootName = noteName(content.root, 0, content.latin);
  const saved = resolvedView(content);
  const reading = { ...saved, ...local.view };
  const show: ShowMode = local.show ?? reading.labels;
  const emphasis = reading.emphasis;
  const preset = emphasisOf(emphasis);
  const options = { show, emphasis, extensions: reading.extensions, colorByPosition: false };
  const extensions = local.view.extensions ?? saved.extensions;
  const present = rolesPresent(content, extensions);

  /** Reading choices are saved with the map, except while only reading it. */
  function changeReading(patch: Partial<FretboardView>) {
    if (readOnly) setLocal((current) => ({ ...current, view: { ...current.view, ...patch } }));
    else onChange((current) => setView(current, patch));
  }
  function chooseShow(value: ShowMode) {
    if (value === 'fingers' || value === 'positions') setLocal((current) => ({ ...current, show: value }));
    else {
      setLocal((current) => ({ ...current, show: null }));
      changeReading({ labels: value });
    }
    if (value !== 'fingers') setFinger(null);
  }
  const setEmphasisRoles = (roles: Role[] | undefined) => changeReading({ emphasis: roles });

  function pick(positionId: string) {
    return (string: number, fretNumber: number) => {
      if (readOnly) return;
      const position = content.positions.find((item) => item.id === positionId);
      const existing = position?.notes.find((note) => note.string === string && note.fret === fretNumber);
      onChange((current) => {
        if (finger && existing) {
          return existing.finger === finger
            ? toggleNoteIn(current, positionId, string, fretNumber)
            : setNoteFinger(current, positionId, string, fretNumber, finger);
        }
        return toggleNoteIn(current, positionId, string, fretNumber, finger ?? undefined);
      });
    };
  }
  const proposal = useMemo(() => generatedScaleNotes(content, scale), [content, scale]);
  const showOptions = [
    { value: 'notes' as const, label: 'Notas' },
    { value: 'intervals' as const, label: 'Intervalos' },
    { value: 'both' as const, label: 'Ambos', title: 'La nota y, debajo, su intervalo' },
    ...(readOnly ? [] : [{ value: 'fingers' as const, label: 'Dedos' }]),
    ...(view === 'all' ? [{ value: 'positions' as const, label: 'Posiciones', title: 'Colorea por posición en lugar de por grado' }] : []),
  ];
  const singleMarkers = [
    // Other positions' notes show as faint outlines while editing; reading keeps only what matters.
    ...(readOnly
      ? []
      : content.baseNotes
          .filter((note) => !active.notes.some((own) => own.string === note.string && own.fret === note.fret))
          .map((note) => ({ string: note.string, fret: note.fret, tone: 'ghost' as const }))),
    ...markersForPosition(content, active, content.positions.indexOf(active), options),
  ];
  const showLegend = reading.legend && present.length > 0 && show !== 'positions' && show !== 'fingers';

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
              setActiveId(next.id);
              setViewMode('single');
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
                  setActiveId(position.id);
                  setViewMode('single');
                }}
                onDoubleClick={() => !readOnly && setRenaming(position.id)}
              >
                {position.name}
              </button>
            ),
          )}
          {!readOnly && (
            <button
              type="button"
              className="pos-add"
              aria-label="Agregar posición"
              title="Agregar posición"
              onClick={() => {
                onChange((current) => addPosition(current));
                setViewMode('single');
              }}
            >
              <Icon name="plus" size={14} />
            </button>
          )}
        </div>
        <Segmented<View>
          label="Vista del mapa"
          value={view}
          onChange={setViewMode}
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
        <Segmented<ShowMode> label="Qué mostrar en cada nota" value={show} onChange={chooseShow} options={showOptions} />
        <Segmented<Emphasis | 'custom'>
          label="Resaltar"
          value={preset}
          onChange={(value) => value !== 'custom' && changeReading({ emphasis: EMPHASIS_ROLES[value] })}
          options={[
            { value: 'all', label: 'Todo', title: 'Todos los grados en color' },
            { value: 'root', label: 'Tónica' },
            { value: 'triad', label: 'Tríada', title: 'Tónica, tercera y quinta; el resto se atenúa' },
            { value: 'seventh', label: 'Séptima', title: 'Tríada más la séptima' },
          ]}
        />
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
          </>
        )}
        <Menu
          label="Más opciones del mapa"
          triggerClassName="icon-btn"
          align="end"
          trigger={<Icon name="more" />}
          items={[
            { label: 'Mostrar la leyenda', checked: reading.legend, onSelect: () => changeReading({ legend: !reading.legend }) },
            { label: 'Nombrar extensiones (9, 11, 13)', checked: reading.extensions, onSelect: () => changeReading({ extensions: !reading.extensions }) },
            ...(readOnly
              ? []
              : [
                  { separator: true as const },
                  { label: 'Renombrar posición', icon: 'pencil' as const, onSelect: () => setRenaming(active.id) },
                  {
                    label: 'Duplicar posición',
                    icon: 'copy' as const,
                    onSelect: () => {
                      onChange((current) => duplicateSpatialPosition(current, active.id));
                      setViewMode('single');
                    },
                  },
                  { label: 'Vaciar posición', icon: 'close' as const, onSelect: () => onChange((current) => clearPosition(current, active.id)) },
                  {
                    label: 'Eliminar posición',
                    icon: 'trash' as const,
                    danger: true,
                    disabled: content.positions.length <= 1,
                    onSelect: () => onChange((current) => removeSpatialPosition(current, active.id)),
                  },
                  { separator: true as const },
                  { label: 'Nombres: Do Re Mi', checked: content.latin, onSelect: () => onChange((current) => ({ ...current, latin: true })) },
                  { label: 'Nombres: C D E', checked: !content.latin, onSelect: () => onChange((current) => ({ ...current, latin: false })) },
                ]),
          ]}
        />
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
                      setActiveId(position.id);
                      setViewMode('single');
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
                  markers={markersForPosition(content, position, index, options)}
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
            markers={markersForAll(content, { ...options, colorByPosition: show === 'positions' })}
            label="Mástil con todas las posiciones"
            testId="map-all"
          />
          {show === 'positions' && (
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
          )}
        </>
      )}

      {showLegend && (
        <HarmonyLegend
          present={present}
          emphasis={emphasis}
          onChange={setEmphasisRoles}
          labelFor={(role) => legendLabel(content, role, reading.extensions)}
        />
      )}
    </div>
  );
}
