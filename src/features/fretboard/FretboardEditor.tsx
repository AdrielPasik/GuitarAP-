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
    {!readOnly && <div className="mt-4 flex flex-wrap gap-2"><select aria-label="Tónica" className="control" value={content.root} onChange={(event) => setContent((current) => ({ ...current, root: Number(event.target.value) }))}>{Array.from({ length: 12 }, (_, root) => <option key={root} value={root}>{noteName(root, 0, content.latin)}</option>)}</select><button className="control" onClick={() => setContent((current) => ({ ...current, notation: current.notation === 'notes' ? 'intervals' : 'notes' }))}>{content.notation === 'notes' ? 'Mostrar intervalos' : 'Mostrar notas'}</button><button className="control" onClick={() => setContent((current) => ({ ...current, latin: !current.latin }))}>{content.latin ? 'ABC' : 'Do Re Mi'}</button><select aria-label="Generar escala" className="control" defaultValue="" onChange={(event) => { if (event.target.value) generateScale(event.target.value as ScaleName); event.currentTarget.value = ''; }}><option value="">Generar escala…</option>{Object.keys(SCALE_PATTERNS).map((name) => <option key={name}>{name}</option>)}</select><span className="self-center text-xs text-stone-500">Digitación:</span>{([1, 2, 3, 4] as const).map((number) => <button key={number} className={`control !px-2 ${finger === number ? '!border-amber-600' : ''}`} onClick={() => setFinger(number)}>{number}</button>)}</div>}
    <div className="mt-4 flex flex-wrap items-center gap-2"><button className={`control ${view === 'position' ? '!border-amber-600' : ''}`} onClick={() => setView('position')}>Individual</button><button className={`control ${view === 'combined' ? '!border-amber-600' : ''}`} onClick={() => setView('combined')}>Conjunta</button><button className={`control ${view === 'complete' ? '!border-amber-600' : ''}`} onClick={() => setView('complete')}>Completa</button>{!readOnly && <button className="control" onClick={addPosition}>+ Posición</button>}{content.positions.map((item) => <button key={item.id} className={`text-xs ${item.id === position.id ? 'font-semibold text-amber-700' : 'text-stone-500'}`} onClick={() => setContent((current) => ({ ...current, selectedPositionId: item.id }))}>{item.name}</button>)}</div>
    {!readOnly && <div className="mt-3 flex gap-2"><input aria-label="Nombre de posición" className="control min-w-48" value={position.name} onChange={(event) => setContent((current) => ({ ...current, positions: current.positions.map((item) => item.id === position.id ? { ...item, name: event.target.value } : item) }))} /><input aria-label="Comentarios de posición" className="control min-w-64 flex-1" value={position.comments ?? ''} placeholder="Anotaciones de esta posición…" onChange={(event) => setContent((current) => ({ ...current, positions: current.positions.map((item) => item.id === position.id ? { ...item, comments: event.target.value } : item) }))} /></div>}
    <div ref={exportRef} className="mt-6 overflow-x-auto rounded-xl border border-stone-300 bg-gradient-to-br from-[#52351e] to-[#23140c] p-4 shadow-inner"><svg role="img" aria-label="Diapasón interactivo" viewBox={`0 0 ${(content.maxFret + 1) * 58 + 35} 250`} className="min-w-[740px] w-full"><rect x="0" y="0" width={(content.maxFret + 1) * 58 + 35} height="250" rx="8" fill="#2b190f" />{frets.map((fret) => <g key={fret}><line x1={35 + fret * 58} y1="12" x2={35 + fret * 58} y2="238" stroke={fret === 0 ? '#e7c78d' : '#b68a55'} strokeWidth={fret === 0 ? 5 : 1} /><text x={64 + fret * 58} y="246" textAnchor="middle" fontSize="9" fill="#efd6a8">{fret + 1}</text></g>)}{content.tuning.map((tuning, string) => <g key={tuning + string}><line x1="15" y1={34 + string * 37} x2={(content.maxFret + 1) * 58 + 20} y2={34 + string * 37} stroke="#e6c28c" strokeWidth={1 + string * .35} /><text x="5" y={38 + string * 37} textAnchor="start" fontSize="10" fill="#f4dfba">{tuning.replace(/[0-9]/g, '')}</text>{frets.map((fret) => { const pitch = (tuningPitch(tuning) + fret) % 12; const markedNote = shownNotes.find((note) => note.string === string && note.fret === fret); const marked = Boolean(markedNote); const isRoot = pitch === content.root; const label = content.notation === 'notes' ? noteName(pitch, 0, content.latin) : String((pitch - content.root + 12) % 12); return <g key={fret} onClick={() => !readOnly && view === 'position' && toggle(string, fret)} className={!readOnly && view === 'position' ? 'cursor-pointer' : ''}><circle cx={35 + fret * 58} cy={34 + string * 37} r={marked ? 13 : 8} fill={marked ? (isRoot ? '#f59e0b' : '#f9e5bb') : 'transparent'} stroke={marked ? '#fff2c9' : 'transparent'} /><text x={35 + fret * 58} y={38 + string * 37} textAnchor="middle" fontSize="9" fontWeight="700" fill={marked ? '#3f260e' : 'transparent'}>{marked && markedNote?.finger ? markedNote.finger : label}</text></g>; })}</g>)}</svg></div>
    <p className="mt-3 text-xs text-stone-500">Individual permite editar una posición. Conjunta combina todas las posiciones; Completa muestra el conjunto de notas global. La digitación visible sustituye la etiqueta de nota en cada punto marcado.</p>
  </section>;
}
