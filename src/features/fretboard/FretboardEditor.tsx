import { useEffect, useMemo, useRef, useState } from 'react';
import type { FretNote, FretPosition, FretboardContent, MusicalDocument } from '@/core/model';
import { noteName, SCALE_PATTERNS, tuningPitch, type ScaleName } from '@/core/music';
import { libraryRepository } from '@/data/library-repository';
import { exportPdf, exportPng } from '@/features/export/export-document';
import {
  duplicateSpatialPosition,
  removeSpatialPosition,
  toggleSpatialNote,
  uniqueSpatialNotes,
} from '@/features/fretboard/operations';

type View = 'position' | 'combined' | 'complete';
type LabelMode = 'theory' | 'finger' | 'none';
const positionColors = ['#f2ecd9', '#d8e8bd', '#e4cff0', '#f5d1bc'];
const intervalNames = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];
const noteKey = (note: Pick<FretNote, 'string' | 'fret'>) => `${note.string}:${note.fret}`;
function ownersFor(positions: FretPosition[]) {
  const owners = new Map<string, FretPosition[]>();
  positions.forEach((position) =>
    position.notes.forEach((note) =>
      owners.set(noteKey(note), [...(owners.get(noteKey(note)) ?? []), position]),
    ),
  );
  return owners;
}

function FretboardDiagram({
  content,
  notes,
  owners,
  labelMode,
  editable,
  onToggle,
  testId,
  heading,
}: {
  content: FretboardContent;
  notes: FretNote[];
  owners: Map<string, FretPosition[]>;
  labelMode: LabelMode;
  editable: boolean;
  onToggle?: (string: number, fret: number) => void;
  testId?: string;
  heading?: string;
}) {
  const scale = 58;
  const nutX = 74;
  const boardEnd = nutX + content.maxFret * scale;
  const width = boardEnd + 28;
  const fretNumbers = useMemo(
    () => Array.from({ length: content.maxFret }, (_, index) => index + 1),
    [content.maxFret],
  );
  const noteX = (fret: number) => (fret === 0 ? nutX - 34 : nutX + (fret - 0.5) * scale);
  const positionFor = (string: number, fret: number) =>
    notes.find((note) => note.string === string && note.fret === fret);
  return (
    <figure data-testid={testId} className="fretboard-diagram">
      {heading && (
        <figcaption className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
          {heading}
        </figcaption>
      )}
      <div className="overflow-x-auto rounded-xl border border-[#b9c5c9] bg-[#26352f] p-4 shadow-inner">
        <svg
          role="img"
          aria-label={heading ? `Diapasón: ${heading}` : 'Diapasón interactivo'}
          viewBox={`0 0 ${width} 270`}
          className="w-full"
          style={{ minWidth: `${Math.max(520, content.maxFret * 48)}px` }}
        >
          <rect x="0" y="0" width={width} height="270" rx="8" fill="#26352f" />
          <rect x={nutX} y="22" width={content.maxFret * scale} height="216" fill="#31443a" />
          <rect x="12" y="22" width={nutX - 12} height="216" fill="#223029" />
          <line
            x1={nutX}
            y1="22"
            x2={nutX}
            y2="238"
            stroke="#f0dc9d"
            strokeWidth="7"
            data-testid="nut"
          />
          {fretNumbers.map((fret) => (
            <g key={fret}>
              <line
                x1={nutX + fret * scale}
                y1="22"
                x2={nutX + fret * scale}
                y2="238"
                stroke="#aebbb1"
                strokeWidth="1"
                data-testid={`fretwire-${fret}`}
              />
              <text x={noteX(fret)} y="258" textAnchor="middle" fontSize="10" fill="#d9e6db">
                {fret}
              </text>
              {[3, 5, 7, 9, 15, 17, 19, 21].includes(fret) && (
                <circle cx={noteX(fret)} cy="130" r="3" fill="#789184" />
              )}
              {(fret === 12 || fret === 24) && (
                <>
                  <circle cx={noteX(fret)} cy="93" r="3" fill="#789184" />
                  <circle cx={noteX(fret)} cy="167" r="3" fill="#789184" />
                </>
              )}
            </g>
          ))}
          <text x={noteX(0)} y="258" textAnchor="middle" fontSize="10" fill="#d9e6db">
            0
          </text>
          {content.tuning.map((tuning, string) => (
            <g key={`${tuning}-${string}`}>
              <line
                x1="15"
                y1={44 + string * 35}
                x2={boardEnd + 10}
                y2={44 + string * 35}
                stroke="#e0d1a8"
                strokeWidth={1 + string * 0.35}
              />
              <text x="3" y={48 + string * 35} textAnchor="start" fontSize="10" fill="#f4e8c6">
                {tuning.replace(/[0-9]/g, '')}
              </text>
              {[0, ...fretNumbers].map((fret) => {
                const pitch = (tuningPitch(tuning) + fret) % 12;
                const marked = positionFor(string, fret);
                const itemOwners = owners.get(`${string}:${fret}`) ?? [];
                const root = pitch === content.root;
                const musicalNote = noteName(pitch, 0, content.latin);
                const interval = intervalNames[(pitch - content.root + 12) % 12];
                const theory = content.notation === 'notes' ? musicalNote : interval;
                const label =
                  labelMode === 'none'
                    ? ''
                    : labelMode === 'finger'
                      ? String(marked?.finger ?? '')
                      : theory;
                const fill = root
                  ? '#4bb5d1'
                  : positionColors[
                      Math.max(
                        0,
                        content.positions.findIndex(
                          (position) => position.id === itemOwners[0]?.id,
                        ),
                      ) % positionColors.length
                    ];
                return (
                  <g
                    key={fret}
                    data-testid={`fret-${string}-${fret}`}
                    data-owners={itemOwners.map((item) => item.name).join(', ')}
                    aria-label={`Cuerda ${string + 1}, traste ${fret}: ${musicalNote}, intervalo ${interval}`}
                    onClick={() => editable && onToggle?.(string, fret)}
                    className={editable ? 'cursor-pointer' : ''}
                  >
                    <title>
                      Cuerda {string + 1}, traste {fret}: {musicalNote} · intervalo {interval}
                      {itemOwners.length
                        ? ` · ${itemOwners.map((owner) => owner.name).join(', ')}`
                        : ''}
                    </title>
                    <circle cx={noteX(fret)} cy={44 + string * 35} r="22" fill="transparent" />
                    <circle
                      data-note-marker="true"
                      cx={noteX(fret)}
                      cy={44 + string * 35}
                      r={marked ? 14 : 0}
                      fill={marked ? fill : 'transparent'}
                      stroke={marked ? (root ? '#c6f3ff' : '#ffffff') : 'transparent'}
                      strokeWidth={root ? 2 : 1}
                    />
                    <text
                      x={noteX(fret)}
                      y={48 + string * 35}
                      textAnchor="middle"
                      fontSize="9"
                      fontWeight="700"
                      fill={marked ? '#20312a' : 'transparent'}
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
    </figure>
  );
}

export function FretboardEditor({
  document: musicalDocument,
  readOnly = false,
}: {
  document: MusicalDocument;
  readOnly?: boolean;
}) {
  const [content, setContent] = useState(musicalDocument.content as FretboardContent);
  const [title, setTitle] = useState(musicalDocument.title);
  const [view, setView] = useState<View>('position');
  const [finger, setFinger] = useState<1 | 2 | 3 | 4>(1);
  const [labelMode, setLabelMode] = useState<LabelMode>('theory');
  const lastSaved = useRef(JSON.stringify({ title, content }));
  const exportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (readOnly) return;
    const next = JSON.stringify({ title, content });
    if (next === lastSaved.current) return;
    const timeout = window.setTimeout(() => {
      void libraryRepository.saveDocument({ ...musicalDocument, title, content });
      lastSaved.current = next;
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [content, musicalDocument, readOnly, title]);
  const position =
    content.positions.find((item) => item.id === content.selectedPositionId) ??
    content.positions[0];
  const owners = useMemo(() => ownersFor(content.positions), [content.positions]);
  const completeNotes = useMemo(
    () => uniqueSpatialNotes(content.positions.flatMap((item) => item.notes)),
    [content.positions],
  );
  function selectPosition(id: string, open = false) {
    setContent((current) => ({ ...current, selectedPositionId: id }));
    if (open) setView('position');
  }
  function toggle(string: number, fret: number) {
    setContent((current) => toggleSpatialNote(current, string, fret, finger));
  }
  function generateScale(name: ScaleName) {
    const intervals = SCALE_PATTERNS[name];
    const notes: FretNote[] = [];
    content.tuning.forEach((tuning, string) => {
      for (let fret = 0; fret <= content.maxFret; fret += 1)
        if (intervals.includes(((tuningPitch(tuning) + fret - content.root + 12) % 12) as never))
          notes.push({ string, fret, root: (tuningPitch(tuning) + fret) % 12 === content.root });
    });
    if (window.confirm(`¿Reemplazar ${position.name} con ${name}?`))
      setContent((current) => ({
        ...current,
        positions: current.positions.map((item) =>
          item.id === position.id ? { ...item, notes } : item,
        ),
        baseNotes: uniqueSpatialNotes(
          current.positions.flatMap((item) => (item.id === position.id ? notes : item.notes)),
        ),
      }));
  }
  function addPosition() {
    const next = {
      id: crypto.randomUUID(),
      name: `Posición ${content.positions.length + 1}`,
      notes: [],
    };
    setContent((current) => ({
      ...current,
      positions: [...current.positions, next],
      selectedPositionId: next.id,
    }));
    setView('position');
  }
  function duplicatePosition() {
    setContent((current) => duplicateSpatialPosition(current, position.id));
  }
  function deletePosition() {
    if (content.positions.length <= 1) return;
    if (window.confirm(`¿Eliminar ${position.name}? Las demás posiciones no se modificarán.`))
      setContent((current) => removeSpatialPosition(current, position.id));
  }
  const diagram = (
    <FretboardDiagram
      content={content}
      notes={position.notes}
      owners={owners}
      labelMode={labelMode}
      editable={!readOnly}
      onToggle={toggle}
      testId="position-diagram"
      heading={position.name}
    />
  );
  return (
    <section className="fretboard-editor-shell">
      <div className="editor-document-header">
        <div className="editor-title-block">
          <span className="document-type-label">MAPA DE NOTAS · sin secuencia temporal</span>
          <input
            aria-label="Título del diapasón"
            readOnly={readOnly}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <p>
            {readOnly
              ? 'Lectura enfocada del diagrama'
              : `${position.name} · marcado libre · guardado automático local`}
          </p>
        </div>
        <div className="editor-primary-actions">
          <button
            className="control"
            onClick={() => exportRef.current && void exportPng(exportRef.current, title)}
          >
            PNG
          </button>
          <button
            className="control"
            onClick={() => exportRef.current && void exportPdf(exportRef.current, title)}
          >
            PDF
          </button>
        </div>
      </div>
      {!readOnly && (
        <div className="fretboard-control-deck">
          <span className="toolbar-label">Construcción y lectura</span>
          <select
            aria-label="Tónica"
            className="control"
            value={content.root}
            onChange={(event) =>
              setContent((current) => ({ ...current, root: Number(event.target.value) }))
            }
          >
            {Array.from({ length: 12 }, (_, root) => (
              <option key={root} value={root}>
                {noteName(root, 0, content.latin)}
              </option>
            ))}
          </select>
          <select
            aria-label="Rango de trastes"
            className="control"
            value={content.maxFret}
            onChange={(event) =>
              setContent((current) => ({ ...current, maxFret: Number(event.target.value) }))
            }
          >
            {[5, 12, 15, 18, 21, 24].map((fret) => (
              <option key={fret} value={fret}>
                {fret} trastes
              </option>
            ))}
          </select>
          <button
            className="control"
            onClick={() =>
              setContent((current) => ({
                ...current,
                notation: current.notation === 'notes' ? 'intervals' : 'notes',
              }))
            }
          >
            {content.notation === 'notes' ? 'Mostrar intervalos' : 'Mostrar notas'}
          </button>
          <button
            className="control"
            onClick={() => setContent((current) => ({ ...current, latin: !current.latin }))}
          >
            {content.latin ? 'ABC' : 'Do Re Mi'}
          </button>
          <select
            aria-label="Etiqueta de nota"
            className="control"
            value={labelMode}
            onChange={(event) => setLabelMode(event.target.value as LabelMode)}
          >
            <option value="theory">Notas / intervalos</option>
            <option value="finger">Digitación</option>
            <option value="none">Sin etiquetas</option>
          </select>
          <select
            aria-label="Generar escala"
            className="control"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) generateScale(event.target.value as ScaleName);
              event.currentTarget.value = '';
            }}
          >
            <option value="">Generar escala…</option>
            {Object.keys(SCALE_PATTERNS).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <span className="finger-label">Dedo</span>
          {([1, 2, 3, 4] as const).map((number) => (
            <button
              key={number}
              className={`finger-button ${finger === number ? 'active' : ''}`}
              onClick={() => setFinger(number)}
            >
              {number}
            </button>
          ))}
        </div>
      )}
      <div className="fretboard-view-bar">
        <div className="view-switcher">
          <button
            className={view === 'position' ? 'active' : ''}
            onClick={() => setView('position')}
          >
            Individual
          </button>
          <button
            className={view === 'combined' ? 'active' : ''}
            onClick={() => setView('combined')}
          >
            Conjunta
          </button>
          <button
            className={view === 'complete' ? 'active' : ''}
            onClick={() => setView('complete')}
          >
            Completa
          </button>
        </div>
        {!readOnly && (
          <button className="control-primary" onClick={addPosition}>
            + Posición
          </button>
        )}
        <div className="position-tabs">
          {content.positions.map((item) => (
            <button
              key={item.id}
              className={item.id === position.id ? 'active' : ''}
              onClick={() => selectPosition(item.id, view === 'combined')}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>
      {!readOnly && view === 'position' && (
        <div className="position-editor-bar">
          <input
            aria-label="Nombre de posición"
            className="control min-w-48"
            value={position.name}
            onChange={(event) =>
              setContent((current) => ({
                ...current,
                positions: current.positions.map((item) =>
                  item.id === position.id ? { ...item, name: event.target.value } : item,
                ),
              }))
            }
          />
          <input
            aria-label="Comentarios de posición"
            className="control min-w-64 flex-1"
            value={position.comments ?? ''}
            placeholder="Anotaciones de esta posición…"
            onChange={(event) =>
              setContent((current) => ({
                ...current,
                positions: current.positions.map((item) =>
                  item.id === position.id ? { ...item, comments: event.target.value } : item,
                ),
              }))
            }
          />
          <button className="control" onClick={duplicatePosition}>
            Duplicar posición
          </button>
          <button
            className="control danger"
            disabled={content.positions.length <= 1}
            onClick={deletePosition}
          >
            Eliminar posición
          </button>
        </div>
      )}
      <div ref={exportRef} className="mt-6">
        {view === 'position' ? (
          diagram
        ) : view === 'combined' ? (
          <div data-testid="combined-positions" className="grid gap-4 xl:grid-cols-2">
            {content.positions.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-stone-200 p-3 dark:border-white/10"
              >
                <button
                  className="mb-2 text-left text-sm font-semibold text-amber-700 dark:text-amber-300"
                  onClick={() => selectPosition(item.id, true)}
                >
                  Editar {item.name}
                </button>
                <FretboardDiagram
                  content={content}
                  notes={item.notes}
                  owners={ownersFor([item])}
                  labelMode={labelMode}
                  editable={false}
                  testId={`position-diagram-${item.id}`}
                  heading={item.name}
                />
              </div>
            ))}
          </div>
        ) : (
          <>
            <FretboardDiagram
              content={content}
              notes={completeNotes}
              owners={owners}
              labelMode={labelMode}
              editable={false}
              testId="complete-diagram"
              heading="Todas las posiciones"
            />
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-stone-500">
              {content.positions.map((item, index) => (
                <span key={item.id}>
                  <i
                    className="mr-1 inline-block size-2 rounded-full"
                    style={{ background: positionColors[index % positionColors.length] }}
                  />
                  {item.name}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <p className="mt-3 text-xs text-stone-500">
        {readOnly
          ? 'Vista de solo lectura. Cambiá entre posiciones sin modificar el material.'
          : view === 'position'
            ? 'Cada punto se centra en el espacio físico de su traste. Individual permite editar la posición seleccionada y su digitación.'
            : view === 'combined'
              ? 'Conjunta compara un mástil por cada posición; elegí “Editar” para abrir una de ellas.'
              : 'Completa reúne las notas actuales en un solo mástil; el color indica la posición de procedencia.'}
      </p>
    </section>
  );
}
