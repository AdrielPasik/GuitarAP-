import { useEffect, useMemo, useRef, useState } from 'react';
import type { LinkedTechnique, MusicalDocument, TablatureContent, Technique } from '@/core/model';
import { useUndoRedo } from '@/core/use-undo-redo';
import { libraryRepository } from '@/data/library-repository';
import { exportPdf, exportPng } from '@/features/export/export-document';
import { TabFretInput } from '@/features/tablature/TabFretInput';
import {
  annotateColumn,
  copyTabFragment,
  insertColumn as insert,
  linkTechnique,
  pasteTabFragment,
  removeColumn,
  setFret as setCellFret,
  toggleTechnique as toggleCellTechnique,
  type TabClipboard,
} from '@/features/tablature/operations';

const techniqueLabels: Record<Technique, string> = {
  'hammer-on': 'H',
  'pull-off': 'P',
  'slide-up': '/',
  'slide-down': '\\',
  'bend-half': '¼',
  'bend-full': '½',
  vibrato: '~',
  mute: 'x',
};
const techniqueNames: Record<Technique, string> = {
  'hammer-on': 'Hammer-on',
  'pull-off': 'Pull-off',
  'slide-up': 'Slide +',
  'slide-down': 'Slide −',
  'bend-half': 'Bend ½',
  'bend-full': 'Bend 1',
  vibrato: 'Vibrato',
  mute: 'Apagada',
};
type Cell = { column: number; string: number };
type EditorMode = 'sequence' | 'fretboard' | 'split';

export function TablatureEditor({
  document: musicalDocument,
  readOnly = false,
}: {
  document: MusicalDocument;
  readOnly?: boolean;
}) {
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
  const [editorMode, setEditorMode] = useState<EditorMode>('sequence');
  const [visibleFrets, setVisibleFrets] = useState(12);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const lastSaved = useRef(JSON.stringify({ title, content }));
  const exportRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const columns = useMemo(() => content.columns, [content.columns]);
  const columnIndexById = useMemo(
    () => new Map(columns.map((column, index) => [column.id, index])),
    [columns],
  );
  const columnsPerRow = autoWrap
    ? Math.max(4, Math.min(40, Math.floor((availableWidth - 58) / (content.zoom * 37.6))))
    : content.wrapAfter;
  const systems = useMemo(() => {
    const rows: Array<{ columns: typeof columns; start: number }> = [];
    let row: typeof columns = [];
    let start = 0;
    columns.forEach((column, index) => {
      if (row.length && (row.length >= columnsPerRow || column.lineBreak)) {
        rows.push({ columns: row, start });
        row = [];
        start = index;
      }
      row.push(column);
    });
    if (row.length) rows.push({ columns: row, start });
    return rows;
  }, [columns, columnsPerRow]);
  const range = {
    start: Math.min(selected.column, rangeEnd?.column ?? selected.column),
    end: Math.max(selected.column, rangeEnd?.column ?? selected.column),
  };

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
  useEffect(() => {
    const element = sheetRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [editorMode]);

  function focusCell(next: Cell) {
    setSelected(next);
    window.requestAnimationFrame(() =>
      window.document.getElementById(`tab-cell-${next.column}-${next.string}`)?.focus(),
    );
  }
  function changeFret(columnIndex: number, stringIndex: number, value: string) {
    const fret = value === '' ? undefined : Number(value);
    if (fret !== undefined && (!Number.isInteger(fret) || fret < 0 || fret > 24)) return;
    history.set((current) => setCellFret(current, columnIndex, stringIndex, fret));
  }
  function inputFromFretboard(stringIndex: number, fret: number) {
    const alreadyEntered = content.columns[selected.column]?.cells[stringIndex]?.fret === fret;
    changeFret(selected.column, stringIndex, alreadyEntered ? '' : String(fret));
    if (!alreadyEntered && autoAdvance) {
      setSelected((current) => ({
        column: Math.min(columns.length - 1, current.column + 1),
        string: stringIndex,
      }));
      return;
    }
    setSelected((current) => ({ ...current, string: stringIndex }));
  }

  function moveActiveColumn(offset: -1 | 1) {
    setSelected((current) => ({
      ...current,
      column: Math.max(0, Math.min(columns.length - 1, current.column + offset)),
    }));
    setRangeEnd(null);
  }
  function copySelection() {
    setClipboard(copyTabFragment(content, range.start, range.end));
  }
  function addAnnotation() {
    if (!annotationText.trim()) return;
    history.set((current) => annotateColumn(current, selected.column, annotationText));
    setAnnotationText('');
  }
  function selectCell(cell: Cell, event?: React.MouseEvent<HTMLInputElement>) {
    if (linkSource && (linkSource.column !== cell.column || linkSource.string !== cell.string)) {
      history.set((current) => linkTechnique(current, linkSource, cell, linkType));
      setLinkSource(null);
    }
    setSelected(cell);
    if (event?.shiftKey) setRangeEnd(cell);
    else setRangeEnd(null);
  }
  function onCellKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    column: number,
    string: number,
  ) {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      history.redo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copySelection();
      return;
    }
    if (modifier && event.key.toLowerCase() === 'v' && clipboard) {
      event.preventDefault();
      history.set((current) => pasteTabFragment(current, column, clipboard));
      return;
    }
    const direction =
      event.key === 'ArrowRight'
        ? { column: Math.min(columns.length - 1, column + 1), string }
        : event.key === 'ArrowLeft'
          ? { column: Math.max(0, column - 1), string }
          : event.key === 'ArrowDown'
            ? { column, string: Math.min(content.tuning.length - 1, string + 1) }
            : event.key === 'ArrowUp'
              ? { column, string: Math.max(0, string - 1) }
              : null;
    if (direction) {
      event.preventDefault();
      focusCell(direction);
    }
  }

  const selectedTechniques =
    content.columns[selected.column]?.cells[selected.string]?.techniques ?? [];
  const sequentialEditor = (
    <div ref={sheetRef} className="tab-sheet" style={{ fontSize: `${content.zoom}rem` }}>
      {systems.map((system, systemIndex) => (
        <div
          className="tab-system"
          key={system.columns[0].id}
          style={{
            gridTemplateColumns: `2.7rem repeat(${system.columns.length}, minmax(2.35rem, 1fr))`,
          }}
        >
          <div className="system-count">
            <strong>Sistema {String(systemIndex + 1).padStart(2, '0')}</strong>
            <span>
              columnas {system.start + 1}–{system.start + system.columns.length}
            </span>
          </div>
          {content.tuning.map((tuning, stringIndex) => (
            <div key={`${tuning}-${systemIndex}`} className="contents">
              <div className="tab-string-name">
                <span>{tuning.replace(/[0-9]/g, '')}</span>
                <small>{6 - stringIndex}</small>
              </div>
              {system.columns.map((column, localIndex) => {
                const columnIndex = system.start + localIndex;
                const cell = column.cells[stringIndex];
                const selectedCell =
                  !readOnly && selected.column === columnIndex && selected.string === stringIndex;
                const inRange = !readOnly && columnIndex >= range.start && columnIndex <= range.end;
                const outgoing = (content.techniqueLinks ?? []).filter(
                  (link) => link.from.columnId === column.id && link.from.string === stringIndex,
                );
                const incoming = (content.techniqueLinks ?? []).filter(
                  (link) => link.to.columnId === column.id && link.to.string === stringIndex,
                );
                return (
                  <div
                    key={`${column.id}-${stringIndex}`}
                    className={`tab-cell ${selectedCell ? 'cursor' : ''} ${inRange ? 'range' : ''}`}
                  >
                    <input
                      id={`tab-cell-${columnIndex}-${stringIndex}`}
                      aria-label={`Cuerda ${6 - stringIndex}, columna ${columnIndex + 1}`}
                      readOnly={readOnly}
                      value={cell.fret ?? ''}
                      inputMode="numeric"
                      maxLength={2}
                      onFocus={() => setSelected({ column: columnIndex, string: stringIndex })}
                      onClick={(event) =>
                        selectCell({ column: columnIndex, string: stringIndex }, event)
                      }
                      onChange={(event) => changeFret(columnIndex, stringIndex, event.target.value)}
                      onKeyDown={(event) => onCellKeyDown(event, columnIndex, stringIndex)}
                    />
                    {cell.techniques?.length ? (
                      <span className="technique-mark">
                        {cell.techniques.map((item) => techniqueLabels[item]).join('')}
                      </span>
                    ) : null}
                    {outgoing.map((link) => (
                      <span
                        key={link.id}
                        data-testid={`tech-link-${link.id}`}
                        className="linked-technique outgoing"
                        title={`${link.technique} a columna ${(columnIndexById.get(link.to.columnId) ?? 0) + 1}`}
                      >
                        {techniqueLabels[link.technique]}→
                        {(columnIndexById.get(link.to.columnId) ?? 0) + 1}
                      </span>
                    ))}
                    {incoming.map((link) => (
                      <span
                        key={link.id}
                        className="linked-technique incoming"
                        title={`${link.technique} desde columna ${(columnIndexById.get(link.from.columnId) ?? 0) + 1}`}
                      >
                        ←{techniqueLabels[link.technique]}
                      </span>
                    ))}
                    {column.section && stringIndex === 0 ? (
                      <span className="section-mark">{column.section}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <section className="tab-editor-shell mx-auto max-w-none">
      <header className="editor-document-header">
        <div className="editor-title-block">
          <span className="document-type-label">TAB · 6 cuerdas</span>
          <input
            aria-label="Título de tablatura"
            readOnly={readOnly}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <p>
            {readOnly
              ? 'Lectura enfocada del arreglo'
              : `Columna ${selected.column + 1} · cuerda ${6 - selected.string} · guardado automático local`}
          </p>
        </div>
        <div className="editor-primary-actions">
          {!readOnly && (
            <>
              <button className="control" disabled={!history.canUndo} onClick={history.undo}>
                ↶ Deshacer
              </button>
              <button className="control" disabled={!history.canRedo} onClick={history.redo}>
                ↷ Rehacer
              </button>
            </>
          )}
          <div className="export-actions">
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
      </header>
      {!readOnly && (
        <>
          <div className="editor-mode-bar">
            <div>
              <span className="toolbar-label">Modo de trabajo</span>
              <div className="mode-switcher" role="group" aria-label="Modo de edición">
                <button
                  aria-label="Secuencial"
                  className={editorMode === 'sequence' ? 'active' : ''}
                  aria-pressed={editorMode === 'sequence'}
                  onClick={() => setEditorMode('sequence')}
                >
                  <span>≋</span>
                  <strong>Secuencial</strong>
                  <small>tiempo y técnicas</small>
                </button>
                <button
                  aria-label="Mástil"
                  className={editorMode === 'fretboard' ? 'active' : ''}
                  aria-pressed={editorMode === 'fretboard'}
                  onClick={() => setEditorMode('fretboard')}
                >
                  <span>⌁</span>
                  <strong>Mástil</strong>
                  <small>entrada visual</small>
                </button>
                <button
                  aria-label="Combinada"
                  className={editorMode === 'split' ? 'active' : ''}
                  aria-pressed={editorMode === 'split'}
                  onClick={() => setEditorMode('split')}
                >
                  <span>▤</span>
                  <strong>Combinada</strong>
                  <small>instrumento + tab</small>
                </button>
              </div>
            </div>
            <p>
              Las tres vistas editan el mismo documento. Cambiar de modo no duplica ni transforma
              las notas.
            </p>
          </div>
          <div className="editor-toolbar">
            <div className="toolbar-group technique-tools">
              <span className="toolbar-label">Articulación</span>
              {(Object.keys(techniqueLabels) as Technique[]).map((technique) => (
                <button
                  key={technique}
                  aria-label={technique.replace('-', ' ')}
                  className={`tool-button ${selectedTechniques.includes(technique) ? 'active' : ''}`}
                  title={techniqueNames[technique]}
                  onClick={() =>
                    history.set((current) =>
                      toggleCellTechnique(current, selected.column, selected.string, technique),
                    )
                  }
                >
                  <b>{techniqueLabels[technique]}</b>
                  <span>{techniqueNames[technique]}</span>
                </button>
              ))}
              <label className="tool-select">
                Vínculo{' '}
                <select
                  aria-label="Técnica vinculada"
                  value={linkType}
                  onChange={(event) => setLinkType(event.target.value as LinkedTechnique)}
                >
                  <option value="hammer-on">Hammer-on</option>
                  <option value="pull-off">Pull-off</option>
                  <option value="slide-up">Slide ascendente</option>
                  <option value="slide-down">Slide descendente</option>
                </select>
              </label>
              <button
                className={`control ${linkSource ? 'linking' : ''}`}
                onClick={() => setLinkSource(linkSource ? null : selected)}
              >
                {linkSource ? 'Cancelar vínculo' : 'Enlazar desde selección'}
              </button>
            </div>
            <div className="toolbar-group structure-tools">
              <span className="toolbar-label">Estructura</span>
              <button
                aria-label="Eliminar columna"
                className="control"
                onClick={() => {
                  history.set((current) => removeColumn(current, selected.column));
                  setSelected((current) => ({
                    ...current,
                    column: Math.max(0, Math.min(current.column, columns.length - 2)),
                  }));
                }}
              >
                − Columna
              </button>
              <button
                aria-label="Insertar columna"
                className="control"
                onClick={() => history.set((current) => insert(current, selected.column))}
              >
                + Columna
              </button>
              <button className="control" onClick={copySelection}>
                Copiar{range.start !== range.end ? ` ${range.end - range.start + 1}` : ''}
              </button>
              <button
                className="control"
                disabled={!clipboard}
                onClick={() =>
                  clipboard &&
                  history.set((current) =>
                    pasteTabFragment(current, selected.column + 1, clipboard),
                  )
                }
              >
                Pegar
              </button>
              <button
                className="control"
                onClick={() =>
                  history.set((current) => ({
                    ...current,
                    columns: current.columns.map((column, index) =>
                      index === selected.column
                        ? { ...column, lineBreak: !column.lineBreak }
                        : column,
                    ),
                  }))
                }
              >
                Salto
              </button>
            </div>
            <div className="toolbar-group view-tools">
              <span className="toolbar-label">Lectura</span>
              <label className="tool-select">
                <input
                  aria-label="Ajuste automático"
                  type="checkbox"
                  checked={autoWrap}
                  onChange={(event) => setAutoWrap(event.target.checked)}
                />{' '}
                Reflujo
              </label>
              <label className="tool-select">
                Columnas{' '}
                <select
                  aria-label="Columnas por renglón"
                  disabled={autoWrap}
                  value={content.wrapAfter}
                  onChange={(event) =>
                    history.set((current) => ({
                      ...current,
                      wrapAfter: Number(event.target.value),
                    }))
                  }
                >
                  {[8, 12, 16, 20, 24].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="control"
                onClick={() =>
                  history.set((current) => ({
                    ...current,
                    zoom: Math.min(1.6, current.zoom + 0.1),
                  }))
                }
              >
                A+
              </button>
              <button
                className="control"
                onClick={() =>
                  history.set((current) => ({
                    ...current,
                    zoom: Math.max(0.7, current.zoom - 0.1),
                  }))
                }
              >
                A−
              </button>
            </div>
          </div>
        </>
      )}
      <div ref={exportRef} className={`editor-canvas mode-${editorMode}`}>
        {!readOnly && (editorMode === 'fretboard' || editorMode === 'split') ? (
          <TabFretInput
            content={content}
            selected={selected}
            visibleFrets={visibleFrets}
            autoAdvance={autoAdvance}
            onVisibleFretsChange={setVisibleFrets}
            onAutoAdvanceChange={setAutoAdvance}
            onSelectColumn={(column) => setSelected((current) => ({ ...current, column }))}
            onMoveColumn={moveActiveColumn}
            onInput={inputFromFretboard}
          />
        ) : null}
        {readOnly || editorMode === 'sequence' || editorMode === 'split' ? sequentialEditor : null}
      </div>
      {!readOnly && (
        <div className="annotation-bar">
          <div>
            <span className="toolbar-label">Sección o indicación</span>
            <input
              aria-label="Anotación"
              value={annotationText}
              onChange={(event) => setAnnotationText(event.target.value)}
              placeholder="Verso, estribillo, repetir…"
              onKeyDown={(event) => {
                if (event.key === 'Enter') addAnnotation();
              }}
            />
          </div>
          <button aria-label="Añadir sección" className="control-primary" onClick={addAnnotation}>
            Marcar columna {selected.column + 1}
          </button>
          <p>Shift+clic selecciona un fragmento · Flechas navegan · Ctrl/Cmd+Z deshace</p>
        </div>
      )}
      {linkSource ? (
        <p className="editor-guidance active">
          Elegí la nota destino. La dirección musical del hammer-on, pull-off y slide se valida
          automáticamente.
        </p>
      ) : null}
    </section>
  );
}
