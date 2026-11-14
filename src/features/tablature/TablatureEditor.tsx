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
  const systems = useMemo(() => columns.reduce<typeof columns[]>((rows, column, index) => { const row = Math.floor(index / Math.max(4, content.wrapAfter)); (rows[row] ??= []).push(column); return rows; }, []), [columns, content.wrapAfter]);
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
    {!readOnly && <div className="editor-toolbar"><div><span className="toolbar-label">Técnicas</span>{(Object.keys(techniqueLabels) as Technique[]).map((technique) => <button key={technique} className={`tool-button ${selectedTechniques.includes(technique) ? 'active' : ''}`} title={technique} onClick={() => history.set((current) => toggleCellTechnique(current, selected.column, selected.string, technique))}>{techniqueLabels[technique]} <span>{technique.replace('-', ' ')}</span></button>)}</div><div><span className="toolbar-label">Vista</span><label className="tool-select">Columnas por renglón <select aria-label="Columnas por renglón" value={content.wrapAfter} onChange={(event) => history.set((current) => ({ ...current, wrapAfter: Number(event.target.value) }))}>{[8, 12, 16, 20, 24].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><button className="control" onClick={() => history.set((current) => ({ ...current, zoom: Math.min(1.6, current.zoom + .1) }))}>A+</button><button className="control" onClick={() => history.set((current) => ({ ...current, zoom: Math.max(.7, current.zoom - .1) }))}>A−</button></div></div>}
    <div ref={exportRef} className="tab-sheet" style={{ fontSize: `${content.zoom}rem` }}>
      {systems.map((system, systemIndex) => <div className="tab-system" key={system[0].id} style={{ gridTemplateColumns: `2.4rem repeat(${system.length}, minmax(2.35rem, 1fr))` }}>
        <div className="system-count">{systemIndex + 1}</div>{content.tuning.map((tuning, stringIndex) => <><div key={`${tuning}-${systemIndex}`} className="tab-string-name">{tuning.replace(/[0-9]/g, '')}</div>{system.map((column, localIndex) => { const columnIndex = systemIndex * Math.max(4, content.wrapAfter) + localIndex; const cell = column.cells[stringIndex]; const selectedCell = selected.column === columnIndex && selected.string === stringIndex; const inRange = columnIndex >= range.start && columnIndex <= range.end; return <div key={`${column.id}-${stringIndex}`} className={`tab-cell ${selectedCell ? 'cursor' : ''} ${inRange ? 'range' : ''}`}><input id={`tab-cell-${columnIndex}-${stringIndex}`} aria-label={`Cuerda ${6 - stringIndex}, columna ${columnIndex + 1}`} readOnly={readOnly} value={cell.fret ?? ''} inputMode="numeric" maxLength={2} onFocus={() => setSelected({ column: columnIndex, string: stringIndex })} onClick={(event) => { if (event.shiftKey) setRangeEnd({ column: columnIndex, string: stringIndex }); else setRangeEnd(null); }} onChange={(event) => changeFret(columnIndex, stringIndex, event.target.value)} onKeyDown={(event) => onCellKeyDown(event, columnIndex, stringIndex)} />{cell.techniques?.length ? <span className="technique-mark">{cell.techniques.map((item) => techniqueLabels[item]).join('')}</span> : null}{column.section && stringIndex === 0 ? <span className="section-mark">{column.section}</span> : null}</div>; })}</>)}
      </div>)}
    </div>
    {!readOnly && <div className="mt-3 flex gap-2"><input aria-label="Anotación" className="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 text-sm" placeholder="Anotación o sección…" onKeyDown={(event) => { if (event.key === 'Enter' && event.currentTarget.value.trim()) { history.set((current) => annotateColumn(current, selected.column, event.currentTarget.value)); event.currentTarget.value = ''; } }} /><span className="text-xs text-stone-500">Enter marca la columna; Shift+clic selecciona un fragmento.</span></div>}
    <p className="mt-3 text-xs text-stone-500">Escribí 0–24 directamente. Flechas navegan entre celdas; Ctrl/Cmd+Z y Ctrl/Cmd+Y deshacen o rehacen. Las técnicas se adjuntan a la nota seleccionada.</p>
  </section>;
}
