import { useEffect, useMemo, useRef, useState } from 'react';
import type { FretNote, FretboardContent, MusicalDocument } from '@/core/model';
import { noteName, SCALE_PATTERNS, tuningPitch, type ScaleName } from '@/core/music';
import { libraryRepository } from '@/data/library-repository';

function hasNote(notes: FretNote[], string: number, fret: number) { return notes.some((note) => note.string === string && note.fret === fret); }

export function FretboardEditor({ document }: { document: MusicalDocument }) {
  const [content, setContent] = useState(document.content as FretboardContent);
  const [title, setTitle] = useState(document.title);
  const [view, setView] = useState<'position' | 'complete'>('position');
  const lastSaved = useRef(JSON.stringify({ title, content }));
  useEffect(() => { const next = JSON.stringify({ title, content }); if (next === lastSaved.current) return; const timeout = window.setTimeout(() => { void libraryRepository.saveDocument({ ...document, title, content }); lastSaved.current = next; }, 700); return () => window.clearTimeout(timeout); }, [content, document, title]);
  const position = content.positions.find((item) => item.id === content.selectedPositionId) ?? content.positions[0];
  const shownNotes = view === 'complete' ? content.baseNotes : position.notes;

  function toggle(string: number, fret: number) {
    setContent((current) => {
      const currentPosition = current.positions.find((item) => item.id === current.selectedPositionId)!;
      const exists = hasNote(currentPosition.notes, string, fret);
      const positionNotes = exists ? currentPosition.notes.filter((note) => note.string !== string || note.fret !== fret) : [...currentPosition.notes, { string, fret }];
      const baseNotes = exists ? current.baseNotes : hasNote(current.baseNotes, string, fret) ? current.baseNotes : [...current.baseNotes, { string, fret }];
      return { ...current, positions: current.positions.map((item) => item.id === currentPosition.id ? { ...item, notes: positionNotes } : item), baseNotes };
    });
  }
  function setRoot(root: number) { setContent((current) => ({ ...current, root })); }
  function generateScale(name: ScaleName) {
    const intervals = SCALE_PATTERNS[name];
    const notes: FretNote[] = [];
    content.tuning.forEach((tuning, string) => { for (let fret = 0; fret <= content.maxFret; fret += 1) if (intervals.includes(((tuningPitch(tuning) + fret - content.root + 12) % 12) as never)) notes.push({ string, fret, root: (tuningPitch(tuning) + fret) % 12 === content.root }); });
    if (window.confirm(`¿Reemplazar ${position.name} con ${name}?`)) setContent((current) => ({ ...current, positions: current.positions.map((item) => item.id === position.id ? { ...item, notes } : item), baseNotes: [...new Map([...current.baseNotes, ...notes].map((note) => [`${note.string}:${note.fret}`, note])).values()] }));
  }
  function addPosition() { const newPosition = { id: crypto.randomUUID(), name: `Posición ${content.positions.length + 1}`, notes: [] }; setContent((current) => ({ ...current, positions: [...current.positions, newPosition], selectedPositionId: newPosition.id })); }
  const frets = useMemo(() => Array.from({ length: content.maxFret + 1 }, (_, index) => index), [content.maxFret]);
  return <section>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-white/10"><input aria-label="Título del diapasón" value={title} onChange={(event) => setTitle(event.target.value)} className="min-w-0 bg-transparent text-2xl font-semibold outline-none" /><span className="text-xs text-stone-500">Guardado local automático</span></div>
    <div className="mt-4 flex flex-wrap gap-2"><select className="control" value={content.root} onChange={(event) => setRoot(Number(event.target.value))}>{Array.from({ length: 12 }, (_, root) => <option key={root} value={root}>{noteName(root, 0, content.latin)}</option>)}</select><button className="control" onClick={() => setContent((current) => ({ ...current, notation: current.notation === 'notes' ? 'intervals' : 'notes' }))}>{content.notation === 'notes' ? 'Mostrar intervalos' : 'Mostrar notas'}</button><button className="control" onClick={() => setContent((current) => ({ ...current, latin: !current.latin }))}>{content.latin ? 'ABC' : 'Do Re Mi'}</button><select className="control" defaultValue="" onChange={(event) => { if (event.target.value) generateScale(event.target.value as ScaleName); event.currentTarget.value = ''; }}><option value="">Generar escala…</option>{Object.keys(SCALE_PATTERNS).map((name) => <option key={name}>{name}</option>)}</select></div>
    <div className="mt-4 flex flex-wrap items-center gap-2"><button className={`control ${view === 'position' ? '!border-amber-600' : ''}`} onClick={() => setView('position')}>{position.name}</button><button className={`control ${view === 'complete' ? '!border-amber-600' : ''}`} onClick={() => setView('complete')}>Vista completa</button><button className="control" onClick={addPosition}>+ Posición</button>{content.positions.map((item) => <button key={item.id} className={`text-xs ${item.id === position.id ? 'font-semibold text-amber-700' : 'text-stone-500'}`} onClick={() => setContent((current) => ({ ...current, selectedPositionId: item.id }))}>{item.name}</button>)}</div>
    <div className="mt-6 overflow-x-auto rounded-xl border border-stone-300 bg-gradient-to-br from-[#52351e] to-[#23140c] p-4 shadow-inner"><svg role="img" aria-label="Diapasón interactivo" viewBox={`0 0 ${(content.maxFret + 1) * 58 + 35} 250`} className="min-w-[740px] w-full"><rect x="0" y="0" width={(content.maxFret + 1) * 58 + 35} height="250" rx="8" fill="#2b190f" />{frets.map((fret) => <g key={fret}><line x1={35 + fret * 58} y1="12" x2={35 + fret * 58} y2="238" stroke={fret === 0 ? '#e7c78d' : '#b68a55'} strokeWidth={fret === 0 ? 5 : 1} /><text x={64 + fret * 58} y="246" textAnchor="middle" fontSize="9" fill="#efd6a8">{fret + 1}</text></g>)}{content.tuning.map((tuning, string) => <g key={tuning + string}><line x1="15" y1={34 + string * 37} x2={(content.maxFret + 1) * 58 + 20} y2={34 + string * 37} stroke="#e6c28c" strokeWidth={1 + string * .35} /><text x="5" y={38 + string * 37} textAnchor="start" fontSize="10" fill="#f4dfba">{tuning.replace(/[0-9]/g, '')}</text>{frets.map((fret) => { const pitch = (tuningPitch(tuning) + fret) % 12; const marked = hasNote(shownNotes, string, fret); const isRoot = pitch === content.root; const label = content.notation === 'notes' ? noteName(pitch, 0, content.latin) : String((pitch - content.root + 12) % 12); return <g key={fret} onClick={() => view === 'position' && toggle(string, fret)} className={view === 'position' ? 'cursor-pointer' : ''}><circle cx={35 + fret * 58} cy={34 + string * 37} r={marked ? 13 : 8} fill={marked ? (isRoot ? '#f59e0b' : '#f9e5bb') : 'transparent'} stroke={marked ? '#fff2c9' : 'transparent'} /><text x={35 + fret * 58} y={38 + string * 37} textAnchor="middle" fontSize="9" fontWeight="700" fill={marked ? '#3f260e' : 'transparent'}>{label}</text></g>; })}</g>)}</svg></div>
    <p className="mt-3 text-xs text-stone-500">Clic para agregar o quitar una nota de la posición activa. Agregarla incorpora esa nota al conjunto general; quitarla no modifica otras posiciones.</p>
  </section>;
}
