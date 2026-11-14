import { useEffect, useMemo, useRef, useState } from 'react';
import type { MusicalDocument, TabCell, TablatureContent, Technique } from '@/core/model';
import { libraryRepository } from '@/data/library-repository';

const techniqueLabels: Record<Technique, string> = { 'hammer-on': 'H', 'pull-off': 'P', 'slide-up': '/', 'slide-down': '\\', 'bend-half': '¼', 'bend-full': '½', vibrato: '~', mute: 'x' };

export function TablatureEditor({ document }: { document: MusicalDocument }) {
  const [content, setContent] = useState(document.content as TablatureContent);
  const [title, setTitle] = useState(document.title);
  const [selected, setSelected] = useState({ column: 0, string: 0 });
  const lastSaved = useRef(JSON.stringify({ title, content }));

  useEffect(() => {
    const next = JSON.stringify({ title, content });
    if (next === lastSaved.current) return;
    const timeout = window.setTimeout(() => { void libraryRepository.saveDocument({ ...document, title, content }); lastSaved.current = next; }, 700);
    return () => window.clearTimeout(timeout);
  }, [content, document, title]);

  function changeCell(columnIndex: number, stringIndex: number, change: Partial<TabCell>) {
    setContent((current) => ({ ...current, columns: current.columns.map((column, index) => index !== columnIndex ? column : { ...column, cells: column.cells.map((cell, string) => string !== stringIndex ? cell : { ...cell, ...change }) }) }));
  }
  function setFret(columnIndex: number, stringIndex: number, value: string) {
    const fret = value === '' ? undefined : Number(value);
    if (fret !== undefined && (!Number.isInteger(fret) || fret < 0 || fret > 24)) return;
    changeCell(columnIndex, stringIndex, { fret });
  }
  function insertColumn() { setContent((current) => ({ ...current, columns: [...current.columns.slice(0, selected.column + 1), { id: crypto.randomUUID(), cells: Array.from({ length: 6 }, () => ({})) }, ...current.columns.slice(selected.column + 1)] })); }
  function deleteColumn() { if (content.columns.length > 1) setContent((current) => ({ ...current, columns: current.columns.filter((_, index) => index !== selected.column) })); }
  function toggleTechnique(technique: Technique) {
    const cell = content.columns[selected.column]?.cells[selected.string]; if (!cell) return;
    const set = new Set(cell.techniques ?? []);
    if (set.has(technique)) set.delete(technique);
    else set.add(technique);
    changeCell(selected.column, selected.string, { techniques: [...set] });
  }
  const selectedTechniques = content.columns[selected.column]?.cells[selected.string]?.techniques ?? [];
  const columns = useMemo(() => content.columns, [content.columns]);

  return <section className="mx-auto max-w-none">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-white/10">
      <input aria-label="Título de tablatura" value={title} onChange={(event) => setTitle(event.target.value)} className="min-w-0 bg-transparent text-2xl font-semibold outline-none" />
      <div className="flex gap-2"><button className="control" onClick={deleteColumn}>Eliminar compás</button><button className="control" onClick={insertColumn}>Insertar columna</button><span className="self-center text-xs text-stone-500">Guardado local automático</span></div>
    </div>
    <div className="mt-3 flex flex-wrap gap-1 border-b border-stone-200 pb-3 dark:border-white/10">{(Object.keys(techniqueLabels) as Technique[]).map((technique) => <button key={technique} className={`control !px-2 ${selectedTechniques.includes(technique) ? '!border-amber-600 !bg-amber-100 dark:!bg-amber-900/40' : ''}`} title={technique} onClick={() => toggleTechnique(technique)}>{techniqueLabels[technique]}</button>)}<button className="control ml-auto" onClick={() => setContent((current) => ({ ...current, zoom: Math.min(1.6, current.zoom + .1) }))}>A+</button><button className="control" onClick={() => setContent((current) => ({ ...current, zoom: Math.max(.7, current.zoom - .1) }))}>A−</button></div>
    <div className="mt-6 overflow-x-auto rounded-xl border border-stone-200 bg-[#fffdf8] p-4 shadow-sm dark:border-white/10 dark:bg-[#171511]">
      <div style={{ fontSize: `${content.zoom}rem`, minWidth: `${columns.length * 3.1 + 5}rem` }} className="font-mono">
        {content.tuning.map((tuning, stringIndex) => <div key={tuning + stringIndex} className="flex h-10 items-center"><span className="w-8 text-right text-xs text-stone-500">{tuning.replace(/[0-9]/g, '')}</span>{columns.map((column, columnIndex) => { const cell = column.cells[stringIndex]; const selectedCell = selected.column === columnIndex && selected.string === stringIndex; return <div key={column.id} className={`relative h-9 w-12 border-b border-stone-400/70 ${selectedCell ? 'bg-amber-100 dark:bg-amber-900/30' : ''}`}><input aria-label={`Cuerda ${6 - stringIndex}, columna ${columnIndex + 1}`} value={cell.fret ?? ''} inputMode="numeric" maxLength={2} onFocus={() => setSelected({ column: columnIndex, string: stringIndex })} onChange={(event) => setFret(columnIndex, stringIndex, event.target.value)} onKeyDown={(event) => { if (event.key === 'ArrowRight') setSelected({ column: Math.min(columns.length - 1, columnIndex + 1), string: stringIndex }); if (event.key === 'ArrowLeft') setSelected({ column: Math.max(0, columnIndex - 1), string: stringIndex }); }} className="absolute inset-0 w-full bg-transparent text-center text-sm outline-none" />{cell.techniques?.length ? <span className="absolute -right-0.5 -top-2 text-[9px] text-amber-700">{cell.techniques.map((item) => techniqueLabels[item]).join('')}</span> : null}</div>; })}</div>)}
      </div>
    </div>
    <p className="mt-3 text-xs text-stone-500">Escribí 0–24 directamente; los dos dígitos pertenecen a la misma celda. Las flechas cambian de celda y las técnicas se adjuntan a la nota seleccionada.</p>
  </section>;
}
