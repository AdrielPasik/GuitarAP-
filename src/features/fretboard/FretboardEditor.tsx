import { useEffect, useMemo, useRef, useState } from 'react';
import type { FretNote, FretboardContent, MusicalDocument } from '@/core/model';
import { noteName, SCALE_PATTERNS, tuningPitch, type ScaleName } from '@/core/music';
import { libraryRepository } from '@/data/library-repository';
import { exportPdf, exportPng } from '@/features/export/export-document';

type View = 'position' | 'combined' | 'complete';
function hasNote(notes: FretNote[], string: number, fret: number) { return notes.some((note) => note.string === string && note.fret === fret); }
function uniqueNotes(notes: FretNote[]) { return [...new Map(notes.map((note) => [`${note.string}:${note.fret}`, note])).values()]; }

export function FretboardEditor({ document: musicalDocument, readOnly = false }: { document: MusicalDocument; readOnly?: boolean }) {
  const [content, setContent] = useState(musicalDocument.content as FretboardContent);
  const [title, setTitle] = useState(musicalDocument.title);
  const [view, setView] = useState<View>('position');
  const [finger, setFinger] = useState<1 | 2 | 3 | 4>(1);
  const [labelMode, setLabelMode] = useState<'theory' | 'finger' | 'none'>('theory');
  const lastSaved = useRef(JSON.stringify({ title, content }));
  const exportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (readOnly) return;
    const next = JSON.stringify({ title, content });
    if (next === lastSaved.current) return;
    const timeout = window.setTimeout(() => { void libraryRepository.saveDocument({ ...musicalDocument, title, content }); lastSaved.current = next; }, 700);
    return () => window.clearTimeout(timeout);
  }, [content, musicalDocument, readOnly, title]);
  const position = content.positions.find((item) => item.id === content.selectedPositionId) ?? content.positions[0];
  const shownNotes = view === 'position' ? position.notes : view === 'combined' ? uniqueNotes(content.positions.flatMap((item) => item.notes)) : content.baseNotes;

  function toggle(string: number, fret: number) {
    setContent((current) => {
      const currentPosition = current.positions.find((item) => item.id === current.selectedPositionId);
      if (!currentPosition) return current;
      const existing = currentPosition.notes.find((note) => note.string === string && note.fret === fret);
      const positionNotes = existing ? currentPosition.notes.filter((note) => note !== existing) : [...currentPosition.notes, { string, fret, finger, root: (tuningPitch(current.tuning[string]) + fret) % 12 === current.root }];
      const baseNotes = existing ? current.baseNotes : hasNote(current.baseNotes, string, fret) ? current.baseNotes : [...current.baseNotes, positionNotes.at(-1)!];
      return { ...current, positions: current.positions.map((item) => item.id === currentPosition.id ? { ...item, notes: positionNotes } : item), baseNotes };
    });
  }
  function generateScale(name: ScaleName) {
    const intervals = SCALE_PATTERNS[name];
    const notes: FretNote[] = [];
    content.tuning.forEach((tuning, string) => { for (let fret = 0; fret <= content.maxFret; fret += 1) if (intervals.includes(((tuningPitch(tuning) + fret - content.root + 12) % 12) as never)) notes.push({ string, fret, root: (tuningPitch(tuning) + fret) % 12 === content.root }); });
    if (window.confirm(`¿Reemplazar ${position.name} con ${name}?`)) setContent((current) => ({ ...current, positions: current.positions.map((item) => item.id === position.id ? { ...item, notes } : item), baseNotes: uniqueNotes([...current.baseNotes, ...notes]) }));
  }
  function addPosition() { const newPosition = { id: crypto.randomUUID(), name: `Posición ${content.positions.length + 1}`, notes: [] }; setContent((current) => ({ ...current, positions: [...current.positions, newPosition], selectedPositionId: newPosition.id })); }
  const frets = useMemo(() => Array.from({ length: content.maxFret + 1 }, (_, index) => index), [content.maxFret]);
  return <section>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-white/10"><input aria-label="Título del diapasón" readOnly={readOnly} value={title} onChange={(event) => setTitle(event.target.value)} className="min-w-0 bg-transparent text-2xl font-semibold outline-none" /><div className="flex gap-2"><button className="control" onClick={() => exportRef.current && void exportPng(exportRef.current, title)}>PNG</button><button className="control" onClick={() => exportRef.current && void exportPdf(exportRef.current, title)}>PDF</button>{!readOnly && <span className="self-center text-xs text-stone-500">Guardado local automático</span>}</div></div>
    {!readOnly && <div className="mt-4 flex flex-wrap gap-2"><select aria-label="Tónica" className="control" value={content.root} onChange={(event) => setContent((current) => ({ ...current, root: Number(event.target.value) }))}>{Array.from({ length: 12 }, (_, root) => <option key={root} value={root}>{noteName(root, 0, content.latin)}</option>)}</select><button className="control" onClick={() => setContent((current) => ({ ...current, notation: current.notation === 'notes' ? 'intervals' : 'notes' }))}>{content.notation === 'notes' ? 'Mostrar intervalos' : 'Mostrar notas'}</button><button className="control" onClick={() => setContent((current) => ({ ...current, latin: !current.latin }))}>{content.latin ? 'ABC' : 'Do Re Mi'}</button><select aria-label="Etiqueta de nota" className="control" value={labelMode} onChange={(event) => setLabelMode(event.target.value as typeof labelMode)}><option value="theory">Notas / intervalos</option><option value="finger">Digitación</option><option value="none">Sin etiquetas</option></select><select aria-label="Generar escala" className="control" defaultValue="" onChange={(event) => { if (event.target.value) generateScale(event.target.value as ScaleName); event.currentTarget.value = ''; }}><option value="">Generar escala…</option>{Object.keys(SCALE_PATTERNS).map((name) => <option key={name}>{name}</option>)}</select><span className="self-center text-xs text-stone-500">Dedo:</span>{([1, 2, 3, 4] as const).map((number) => <button key={number} className={`control !px-2 ${finger === number ? '!border-[#1d6b86]' : ''}`} onClick={() => setFinger(number)}>{number}</button>)}</div>}
    <div className="mt-4 flex flex-wrap items-center gap-2"><button className={`control ${view === 'position' ? '!border-amber-600' : ''}`} onClick={() => setView('position')}>Individual</button><button className={`control ${view === 'combined' ? '!border-amber-600' : ''}`} onClick={() => setView('combined')}>Conjunta</button><button className={`control ${view === 'complete' ? '!border-amber-600' : ''}`} onClick={() => setView('complete')}>Completa</button>{!readOnly && <button className="control" onClick={addPosition}>+ Posición</button>}{content.positions.map((item) => <button key={item.id} className={`text-xs ${item.id === position.id ? 'font-semibold text-amber-700' : 'text-stone-500'}`} onClick={() => setContent((current) => ({ ...current, selectedPositionId: item.id }))}>{item.name}</button>)}</div>
    {!readOnly && <div className="mt-3 flex gap-2"><input aria-label="Nombre de posición" className="control min-w-48" value={position.name} onChange={(event) => setContent((current) => ({ ...current, positions: current.positions.map((item) => item.id === position.id ? { ...item, name: event.target.value } : item) }))} /><input aria-label="Comentarios de posición" className="control min-w-64 flex-1" value={position.comments ?? ''} placeholder="Anotaciones de esta posición…" onChange={(event) => setContent((current) => ({ ...current, positions: current.positions.map((item) => item.id === position.id ? { ...item, comments: event.target.value } : item) }))} /></div>}
    <div ref={exportRef} className="mt-6 overflow-x-auto rounded-xl border border-[#b9c5c9] bg-[#26352f] p-4 shadow-inner"><svg role="img" aria-label="Diapasón interactivo" viewBox={`0 0 ${(content.maxFret + 1) * 58 + 35} 270`} className="min-w-[740px] w-full"><rect x="0" y="0" width={(content.maxFret + 1) * 58 + 35} height="270" rx="8" fill="#26352f" />{frets.map((fret) => <g key={fret}><line x1={35 + fret * 58} y1="22" x2={35 + fret * 58} y2="238" stroke={fret === 0 ? '#e8d8a8' : '#9eb1a5'} strokeWidth={fret === 0 ? 6 : 1} />{[3, 5, 7, 9, 15].includes(fret) && <circle cx={35 + fret * 58 + 29} cy="130" r="3" fill="#789184" />}{fret === 12 && <><circle cx={35 + fret * 58 + 29} cy="93" r="3" fill="#789184" /><circle cx={35 + fret * 58 + 29} cy="167" r="3" fill="#789184" /></>}<text x={64 + fret * 58} y="258" textAnchor="middle" fontSize="10" fill="#d9e6db">{fret + 1}</text></g>)}{content.tuning.map((tuning, string) => <g key={tuning + string}><line x1="15" y1={44 + string * 35} x2={(content.maxFret + 1) * 58 + 20} y2={44 + string * 35} stroke="#e0d1a8" strokeWidth={1 + string * .35} /><text x="5" y={48 + string * 35} textAnchor="start" fontSize="10" fill="#f4e8c6">{tuning.replace(/[0-9]/g, '')}</text>{frets.map((fret) => { const pitch = (tuningPitch(tuning) + fret) % 12; const markedNote = shownNotes.find((note) => note.string === string && note.fret === fret); const marked = Boolean(markedNote); const isRoot = pitch === content.root; const theoryLabel = content.notation === 'notes' ? noteName(pitch, 0, content.latin) : String((pitch - content.root + 12) % 12); const label = labelMode === 'none' ? '' : labelMode === 'finger' ? String(markedNote?.finger ?? '') : theoryLabel; return <g key={fret} data-testid={`fret-${string}-${fret}`} aria-label={`Cuerda ${6 - string}, traste ${fret}: ${theoryLabel}`} onClick={() => !readOnly && view === 'position' && toggle(string, fret)} className={!readOnly && view === 'position' ? 'cursor-pointer' : ''}><title>Cuerda {6 - string}, traste {fret}: {theoryLabel}</title><circle cx={35 + fret * 58} cy={44 + string * 35} r={marked ? 14 : 10} fill={marked ? (isRoot ? '#4bb5d1' : '#f2ecd9') : 'transparent'} stroke={marked ? (isRoot ? '#c6f3ff' : '#ffffff') : 'transparent'} /><text x={35 + fret * 58} y={48 + string * 35} textAnchor="middle" fontSize="9" fontWeight="700" fill={marked ? '#20312a' : 'transparent'}>{label}</text></g>; })}</g>)}</svg></div>
    <p className="mt-3 text-xs text-stone-500">Individual permite editar una posición. Conjunta combina todas las posiciones; Completa muestra el conjunto de notas global. La digitación visible sustituye la etiqueta de nota en cada punto marcado.</p>
  </section>;
}
