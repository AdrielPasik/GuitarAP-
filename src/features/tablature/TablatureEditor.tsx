import { useEffect, useMemo, useRef, useState } from 'react';
import type { MusicalDocument, TablatureContent, Technique } from '@/core/model';
import { useUndoRedo } from '@/core/use-undo-redo';
import { libraryRepository } from '@/data/library-repository';
import { exportPdf, exportPng } from '@/features/export/export-document';
import { annotateColumn, copyColumns, insertColumn as insert, pasteColumns, removeColumn, setFret as setCellFret, toggleTechnique as toggleCellTechnique } from '@/features/tablature/operations';

const techniqueLabels: Record<Technique, string> = { 'hammer-on': 'H', 'pull-off': 'P', 'slide-up': '/', 'slide-down': '\\', 'bend-half': '¼', 'bend-full': '½', vibrato: '~', mute: 'x' };
type Cell = { column: number; string: number };

export function TablatureEditor({ document: musicalDocument, readOnly = false }: { document: MusicalDocument; readOnly?: boolean }) {
  const history = useUndoRedo(musicalDocument.content as TablatureContent);
  const content = history.value;
  const [title, setTitle] = useState(musicalDocument.title);
  const [selected, setSelected] = useState<Cell>({ column: 0, string: 0 });
  const [rangeEnd, setRangeEnd] = useState<Cell | null>(null);
  const [clipboard, setClipboard] = useState<ReturnType<typeof copyColumns>>([]);
  const lastSaved = useRef(JSON.stringify({ title, content }));
  const exportRef = useRef<HTMLDivElement>(null);
  const columns = useMemo(() => content.columns, [content.columns]);
  const range = { start: Math.min(selected.column, rangeEnd?.column ?? selected.column), end: Math.max(selected.column, rangeEnd?.column ?? selected.column) };

  useEffect(() => {
    if (readOnly) return;
    const next = JSON.stringify({ title, content });
    if (next === lastSaved.current) return;
    const timeout = window.setTimeout(() => { void libraryRepository.saveDocument({ ...musicalDocument, title, content }); lastSaved.current = next; }, 700);
    return () => window.clearTimeout(timeout);
  }, [content, musicalDocument, readOnly, title]);

  function focusCell(next: Cell) {
    setSelected(next);
    window.requestAnimationFrame(() => window.document.getElementById(`tab-cell-${next.column}-${next.string}`)?.focus());
  }
  function changeFret(columnIndex: number, stringIndex: number, value: string) {
    const fret = value === '' ? undefined : Number(value);
    if (fret !== undefined && (!Number.isInteger(fret) || fret < 0 || fret > 24)) return;
    history.set((current) => setCellFret(current, columnIndex, stringIndex, fret));
  }
  function copySelection() { setClipboard(copyColumns(content, range.start, range.end)); }
  function onCellKeyDown(event: React.KeyboardEvent<HTMLInputElement>, column: number, string: number) {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) history.redo(); else history.undo(); return; }
    if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); history.redo(); return; }
    if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); return; }
    if (modifier && event.key.toLowerCase() === 'v' && clipboard.length) { event.preventDefault(); history.set((current) => pasteColumns(current, column, clipboard)); return; }
    const direction = event.key === 'ArrowRight' ? { column: Math.min(columns.length - 1, column + 1), string } : event.key === 'ArrowLeft' ? { column: Math.max(0, column - 1), string } : event.key === 'ArrowDown' ? { column, string: Math.min(content.tuning.length - 1, string + 1) } : event.key === 'ArrowUp' ? { column, string: Math.max(0, string - 1) } : null;
    if (direction) { event.preventDefault(); focusCell(direction); }
  }
  const selectedTechniques = content.columns[selected.column]?.cells[selected.string]?.techniques ?? [];

  return <section className="mx-auto max-w-none">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-white/10">
      <input aria-label="Título de tablatura" readOnly={readOnly} value={title} onChange={(event) => setTitle(event.target.value)} className="min-w-0 bg-transparent text-2xl font-semibold outline-none" />
      <div className="flex flex-wrap gap-2">{!readOnly && <><button className="control" disabled={!history.canUndo} onClick={history.undo}>Deshacer</button><button className="control" disabled={!history.canRedo} onClick={history.redo}>Rehacer</button><button className="control" onClick={() => history.set((current) => removeColumn(current, selected.column))}>Eliminar columna</button><button className="control" onClick={() => history.set((current) => insert(current, selected.column))}>Insertar columna</button><button className="control" onClick={copySelection}>Copiar {range.start !== range.end ? `${range.end - range.start + 1} compases` : ''}</button><button className="control" disabled={!clipboard.length} onClick={() => history.set((current) => pasteColumns(current, selected.column + 1, clipboard))}>Pegar</button></>}<button className="control" onClick={() => exportRef.current && void exportPng(exportRef.current, title)}>PNG</button><button className="control" onClick={() => exportRef.current && void exportPdf(exportRef.current, title)}>PDF</button>{!readOnly && <span className="self-center text-xs text-stone-500">Guardado local automático</span>}</div>
    </div>
    {!readOnly && <div className="mt-3 flex flex-wrap gap-1 border-b border-stone-200 pb-3 dark:border-white/10">{(Object.keys(techniqueLabels) as Technique[]).map((technique) => <button key={technique} className={`control !px-2 ${selectedTechniques.includes(technique) ? '!border-amber-600 !bg-amber-100 dark:!bg-amber-900/40' : ''}`} title={technique} onClick={() => history.set((current) => toggleCellTechnique(current, selected.column, selected.string, technique))}>{techniqueLabels[technique]}</button>)}<button className="control ml-auto" onClick={() => history.set((current) => ({ ...current, zoom: Math.min(1.6, current.zoom + .1) }))}>A+</button><button className="control" onClick={() => history.set((current) => ({ ...current, zoom: Math.max(.7, current.zoom - .1) }))}>A−</button></div>}
    <div ref={exportRef} className="mt-6 overflow-x-auto rounded-xl border border-stone-200 bg-[#fffdf8] p-4 shadow-sm dark:border-white/10 dark:bg-[#171511]">
      <div style={{ fontSize: `${content.zoom}rem`, minWidth: `${columns.length * 3.1 + 5}rem` }} className="font-mono">
        {content.tuning.map((tuning, stringIndex) => <div key={tuning + stringIndex} className="flex h-10 items-center"><span className="w-8 text-right text-xs text-stone-500">{tuning.replace(/[0-9]/g, '')}</span>{columns.map((column, columnIndex) => { const cell = column.cells[stringIndex]; const selectedCell = selected.column === columnIndex && selected.string === stringIndex; const inRange = columnIndex >= range.start && columnIndex <= range.end; return <div key={column.id} className={`relative h-9 w-12 border-b border-stone-400/70 ${selectedCell ? 'bg-amber-200 dark:bg-amber-900/50' : inRange ? 'bg-amber-100/60 dark:bg-amber-900/20' : ''}`}><input id={`tab-cell-${columnIndex}-${stringIndex}`} aria-label={`Cuerda ${6 - stringIndex}, columna ${columnIndex + 1}`} readOnly={readOnly} value={cell.fret ?? ''} inputMode="numeric" maxLength={2} onFocus={() => setSelected({ column: columnIndex, string: stringIndex })} onClick={(event) => { if (event.shiftKey) setRangeEnd({ column: columnIndex, string: stringIndex }); else setRangeEnd(null); }} onChange={(event) => changeFret(columnIndex, stringIndex, event.target.value)} onKeyDown={(event) => onCellKeyDown(event, columnIndex, stringIndex)} className="absolute inset-0 w-full bg-transparent text-center text-sm outline-none" />{cell.techniques?.length ? <span className="absolute -right-0.5 -top-2 text-[9px] text-amber-700">{cell.techniques.map((item) => techniqueLabels[item]).join('')}</span> : null}{column.section && stringIndex === 0 ? <span className="absolute -top-5 left-0 whitespace-nowrap text-[9px] text-amber-700">{column.section}</span> : null}</div>; })}</div>)}
      </div>
    </div>
    {!readOnly && <div className="mt-3 flex gap-2"><input aria-label="Anotación" className="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 text-sm" placeholder="Anotación o sección…" onKeyDown={(event) => { if (event.key === 'Enter' && event.currentTarget.value.trim()) { history.set((current) => annotateColumn(current, selected.column, event.currentTarget.value)); event.currentTarget.value = ''; } }} /><span className="text-xs text-stone-500">Enter marca la columna; Shift+clic selecciona un fragmento.</span></div>}
    <p className="mt-3 text-xs text-stone-500">Escribí 0–24 directamente. Flechas navegan entre celdas; Ctrl/Cmd+Z y Ctrl/Cmd+Y deshacen o rehacen. Las técnicas se adjuntan a la nota seleccionada.</p>
  </section>;
}
