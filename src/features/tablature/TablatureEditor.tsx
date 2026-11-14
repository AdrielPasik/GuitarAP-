import { useEffect, useMemo, useRef, useState } from 'react';
import type { LinkedTechnique, MusicalDocument, TablatureContent, Technique } from '@/core/model';
import { useUndoRedo } from '@/core/use-undo-redo';
import { libraryRepository } from '@/data/library-repository';
import { exportPdf, exportPng } from '@/features/export/export-document';
import { annotateColumn, copyTabFragment, insertColumn as insert, linkTechnique, pasteTabFragment, removeColumn, setFret as setCellFret, toggleTechnique as toggleCellTechnique, type TabClipboard } from '@/features/tablature/operations';

const techniqueLabels: Record<Technique, string> = { 'hammer-on': 'H', 'pull-off': 'P', 'slide-up': '/', 'slide-down': '\\', 'bend-half': '¼', 'bend-full': '½', vibrato: '~', mute: 'x' };
type Cell = { column: number; string: number };

export function TablatureEditor({ document: musicalDocument, readOnly = false }: { document: MusicalDocument; readOnly?: boolean }) {
  const history = useUndoRedo(musicalDocument.content as TablatureContent);
  const content = history.value;
  const [title, setTitle] = useState(musicalDocument.title);
  const [selected, setSelected] = useState<Cell>({ column: 0, string: 0 });
  const [rangeEnd, setRangeEnd] = useState<Cell | null>(null);
  const [clipboard, setClipboard] = useState<TabClipboard | null>(null);
  const [linkType, setLinkType] = useState<LinkedTechnique>('hammer-on');
  const [linkSource, setLinkSource] = useState<Cell | null>(null);
  const [annotationText, setAnnotationText] = useState('');
  const [autoWrap, setAutoWrap] = useState(true);
  const [availableWidth, setAvailableWidth] = useState(960);
  const lastSaved = useRef(JSON.stringify({ title, content }));
  const exportRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const columns = useMemo(() => content.columns, [content.columns]);
  const columnIndexById = useMemo(() => new Map(columns.map((column, index) => [column.id, index])), [columns]);
  const columnsPerRow = autoWrap ? Math.max(4, Math.min(40, Math.floor((availableWidth - 58) / (content.zoom * 37.6)))) : content.wrapAfter;
  const systems = useMemo(() => { const rows: Array<{ columns: typeof columns; start: number }> = []; let row: typeof columns = []; let start = 0; columns.forEach((column, index) => { if (row.length && (row.length >= columnsPerRow || column.lineBreak)) { rows.push({ columns: row, start }); row = []; start = index; } row.push(column); }); if (row.length) rows.push({ columns: row, start }); return rows; }, [columns, columnsPerRow]);
  const range = { start: Math.min(selected.column, rangeEnd?.column ?? selected.column), end: Math.max(selected.column, rangeEnd?.column ?? selected.column) };

  useEffect(() => {
    if (readOnly) return;
    const next = JSON.stringify({ title, content });
    if (next === lastSaved.current) return;
    const timeout = window.setTimeout(() => { void libraryRepository.saveDocument({ ...musicalDocument, title, content }); lastSaved.current = next; }, 700);
    return () => window.clearTimeout(timeout);
  }, [content, musicalDocument, readOnly, title]);
  useEffect(() => { const element = sheetRef.current; if (!element) return; const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width)); observer.observe(element); return () => observer.disconnect(); }, []);

  function focusCell(next: Cell) {
    setSelected(next);
    window.requestAnimationFrame(() => window.document.getElementById(`tab-cell-${next.column}-${next.string}`)?.focus());
  }
  function changeFret(columnIndex: number, stringIndex: number, value: string) {
    const fret = value === '' ? undefined : Number(value);
    if (fret !== undefined && (!Number.isInteger(fret) || fret < 0 || fret > 24)) return;
    history.set((current) => setCellFret(current, columnIndex, stringIndex, fret));
  }
  function copySelection() { setClipboard(copyTabFragment(content, range.start, range.end)); }
  function addAnnotation() { if (!annotationText.trim()) return; history.set((current) => annotateColumn(current, selected.column, annotationText)); setAnnotationText(''); }
  function selectCell(cell: Cell, event?: React.MouseEvent<HTMLInputElement>) {
    if (linkSource && (linkSource.column !== cell.column || linkSource.string !== cell.string)) {
      history.set((current) => linkTechnique(current, linkSource, cell, linkType));
      setLinkSource(null);
    }
    setSelected(cell);
    if (event?.shiftKey) setRangeEnd(cell); else setRangeEnd(null);
  }
  function onCellKeyDown(event: React.KeyboardEvent<HTMLInputElement>, column: number, string: number) {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) history.redo(); else history.undo(); return; }
    if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); history.redo(); return; }
    if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); return; }
    if (modifier && event.key.toLowerCase() === 'v' && clipboard) { event.preventDefault(); history.set((current) => pasteTabFragment(current, column, clipboard)); return; }
    const direction = event.key === 'ArrowRight' ? { column: Math.min(columns.length - 1, column + 1), string } : event.key === 'ArrowLeft' ? { column: Math.max(0, column - 1), string } : event.key === 'ArrowDown' ? { column, string: Math.min(content.tuning.length - 1, string + 1) } : event.key === 'ArrowUp' ? { column, string: Math.max(0, string - 1) } : null;
    if (direction) { event.preventDefault(); focusCell(direction); }
  }
  const selectedTechniques = content.columns[selected.column]?.cells[selected.string]?.techniques ?? [];

  return <section className="mx-auto max-w-none">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-white/10">
      <input aria-label="Título de tablatura" readOnly={readOnly} value={title} onChange={(event) => setTitle(event.target.value)} className="min-w-0 bg-transparent text-2xl font-semibold outline-none" />
      <div className="flex flex-wrap gap-2">{!readOnly && <><button className="control" disabled={!history.canUndo} onClick={history.undo}>Deshacer</button><button className="control" disabled={!history.canRedo} onClick={history.redo}>Rehacer</button><button className="control" onClick={() => history.set((current) => removeColumn(current, selected.column))}>Eliminar columna</button><button className="control" onClick={() => history.set((current) => insert(current, selected.column))}>Insertar columna</button><button className="control" onClick={copySelection}>Copiar {range.start !== range.end ? `${range.end - range.start + 1} compases` : ''}</button><button className="control" disabled={!clipboard} onClick={() => clipboard && history.set((current) => pasteTabFragment(current, selected.column + 1, clipboard))}>Pegar</button></>}<button className="control" onClick={() => exportRef.current && void exportPng(exportRef.current, title)}>PNG</button><button className="control" onClick={() => exportRef.current && void exportPdf(exportRef.current, title)}>PDF</button>{!readOnly && <span className="self-center text-xs text-stone-500">Guardado local automático</span>}</div>
    </div>
    {!readOnly && <div className="editor-toolbar"><div><span className="toolbar-label">Técnicas</span>{(Object.keys(techniqueLabels) as Technique[]).map((technique) => <button key={technique} className={`tool-button ${selectedTechniques.includes(technique) ? 'active' : ''}`} title={technique} onClick={() => history.set((current) => toggleCellTechnique(current, selected.column, selected.string, technique))}>{techniqueLabels[technique]} <span>{technique.replace('-', ' ')}</span></button>)}<label className="tool-select">Vínculo <select aria-label="Técnica vinculada" value={linkType} onChange={(event) => setLinkType(event.target.value as LinkedTechnique)}><option value="hammer-on">Hammer-on</option><option value="pull-off">Pull-off</option><option value="slide-up">Slide ascendente</option><option value="slide-down">Slide descendente</option></select></label><button className={`control ${linkSource ? '!border-amber-600' : ''}`} onClick={() => setLinkSource(linkSource ? null : selected)}>{linkSource ? 'Cancelar vínculo' : 'Enlazar desde selección'}</button></div><div><span className="toolbar-label">Vista</span><label className="tool-select"><input aria-label="Ajuste automático" type="checkbox" checked={autoWrap} onChange={(event) => setAutoWrap(event.target.checked)} /> Ajuste automático</label><label className="tool-select">Columnas <select aria-label="Columnas por renglón" disabled={autoWrap} value={content.wrapAfter} onChange={(event) => history.set((current) => ({ ...current, wrapAfter: Number(event.target.value) }))}>{[8, 12, 16, 20, 24].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><button className="control" onClick={() => history.set((current) => ({ ...current, columns: current.columns.map((column, index) => index === selected.column ? { ...column, lineBreak: !column.lineBreak } : column) }))}>Salto</button><button className="control" onClick={() => history.set((current) => ({ ...current, zoom: Math.min(1.6, current.zoom + .1) }))}>A+</button><button className="control" onClick={() => history.set((current) => ({ ...current, zoom: Math.max(.7, current.zoom - .1) }))}>A−</button></div></div>}
    <div ref={sheetRef} className="tab-sheet" style={{ fontSize: `${content.zoom}rem` }}><div ref={exportRef}>
      {systems.map((system, systemIndex) => <div className="tab-system" key={system.columns[0].id} style={{ gridTemplateColumns: `2.4rem repeat(${system.columns.length}, minmax(2.35rem, 1fr))` }}>
        <div className="system-count">{systemIndex + 1}</div>{content.tuning.map((tuning, stringIndex) => <div key={`${tuning}-${systemIndex}`} className="contents"><div className="tab-string-name">{tuning.replace(/[0-9]/g, '')}</div>{system.columns.map((column, localIndex) => { const columnIndex = system.start + localIndex; const cell = column.cells[stringIndex]; const selectedCell = !readOnly && selected.column === columnIndex && selected.string === stringIndex; const inRange = !readOnly && columnIndex >= range.start && columnIndex <= range.end; const outgoing = (content.techniqueLinks ?? []).filter((link) => link.from.columnId === column.id && link.from.string === stringIndex); const incoming = (content.techniqueLinks ?? []).filter((link) => link.to.columnId === column.id && link.to.string === stringIndex); return <div key={`${column.id}-${stringIndex}`} className={`tab-cell ${selectedCell ? 'cursor' : ''} ${inRange ? 'range' : ''}`}><input id={`tab-cell-${columnIndex}-${stringIndex}`} aria-label={`Cuerda ${6 - stringIndex}, columna ${columnIndex + 1}`} readOnly={readOnly} value={cell.fret ?? ''} inputMode="numeric" maxLength={2} onFocus={() => setSelected({ column: columnIndex, string: stringIndex })} onClick={(event) => selectCell({ column: columnIndex, string: stringIndex }, event)} onChange={(event) => changeFret(columnIndex, stringIndex, event.target.value)} onKeyDown={(event) => onCellKeyDown(event, columnIndex, stringIndex)} />{cell.techniques?.length ? <span className="technique-mark">{cell.techniques.map((item) => techniqueLabels[item]).join('')}</span> : null}{outgoing.map((link) => <span key={link.id} data-testid={`tech-link-${link.id}`} className="linked-technique outgoing" title={`${link.technique} a columna ${(columnIndexById.get(link.to.columnId) ?? 0) + 1}`}>{techniqueLabels[link.technique]}→{(columnIndexById.get(link.to.columnId) ?? 0) + 1}</span>)}{incoming.map((link) => <span key={link.id} className="linked-technique incoming" title={`${link.technique} desde columna ${(columnIndexById.get(link.from.columnId) ?? 0) + 1}`}>←{techniqueLabels[link.technique]}</span>)}{column.section && stringIndex === 0 ? <span className="section-mark">{column.section}</span> : null}</div>; })}</div>)}
      </div>)}
    </div></div>
    {!readOnly && <div className="mt-3 flex flex-wrap gap-2"><input aria-label="Anotación" value={annotationText} onChange={(event) => setAnnotationText(event.target.value)} className="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 text-sm" placeholder="Anotación o sección…" onKeyDown={(event) => { if (event.key === 'Enter') addAnnotation(); }} /><button className="control" onClick={addAnnotation}>Añadir sección</button><span className="self-center text-xs text-stone-500">Enter marca la columna; Shift+clic selecciona un fragmento.</span></div>}
    <p className="mt-3 text-xs text-stone-500">{readOnly ? 'Vista de solo lectura. Las notas, secciones y técnicas pertenecen al documento seleccionado.' : linkSource ? 'Elegí la nota destino. Hammer-on y slide ascendente requieren un traste mayor; pull-off y slide descendente, uno menor.' : 'Escribí 0–24 directamente. Flechas navegan entre celdas; Ctrl/Cmd+Z y Ctrl/Cmd+Y deshacen o rehacen. Las técnicas simples se adjuntan a la nota; los vínculos conservan origen y destino.'}</p>
  </section>;
}
