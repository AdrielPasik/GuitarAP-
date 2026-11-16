import { useEffect, useMemo, useRef, useState } from 'react';
import type { NotebookContent } from '@/core/model';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { useToast } from '@/components/ui/toast-context';
import { blockMeta } from '@/features/notebook/block-meta';
import { defaultSettings, everything, exportFileName, onlyBlock, planExport, type ExportSelection, type ExportSettings } from '@/features/export/export-plan';
import { ExportSheet, SHEET_WIDTH } from '@/features/export/ExportSheet';
import { exportPdf, exportPng } from '@/features/export/export-render';

const TALL_PNG = 3000; // CSS px: beyond this a single image becomes unwieldy

function blockLabel(block: NotebookContent['blocks'][number], index: number) {
  if (block.kind === 'text') return block.text.trim().split('\n')[0].slice(0, 36) || `Texto ${index + 1}`;
  return block.title?.trim() || `${blockMeta[block.kind].label} ${index + 1}`;
}

/**
 * One place to decide exactly what leaves the app: which blocks, which position of a map, the format,
 * the look. What you see in the preview is the same sheet that gets downloaded.
 */
export function ExportDialog({
  title,
  notebook,
  initial,
  activeBlockId,
  onClose,
}: {
  title: string;
  notebook: NotebookContent;
  initial: ExportSelection;
  activeBlockId?: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [selection, setSelection] = useState<ExportSelection>(initial);
  const [settings, setSettings] = useState<ExportSettings>(defaultSettings);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scale, setScale] = useState(0.5);
  const [sheetHeight, setSheetHeight] = useState(0);
  const sheet = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const items = useMemo(() => planExport(notebook, selection), [notebook, selection]);
  const fileName = exportFileName(title, notebook, selection, settings.format);
  const allSelected = selection.included.length === notebook.blocks.length;
  const preset = allSelected ? 'all' : activeBlockId && selection.included.length === 1 && selection.included[0] === activeBlockId ? 'current' : 'custom';

  useEffect(() => {
    const target = holder.current;
    const element = sheet.current;
    if (!target || !element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setScale(Math.min(1, Math.max(0.2, target.clientWidth / SHEET_WIDTH)));
      setSheetHeight(element.offsetHeight);
    });
    observer.observe(target);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const patch = (change: Partial<ExportSettings>) => setSettings((current) => ({ ...current, ...change }));
  const toggleBlock = (id: string) =>
    setSelection((current) => ({
      ...current,
      included: notebook.blocks.map((block) => block.id).filter((blockId) => (blockId === id ? !current.included.includes(id) : current.included.includes(blockId))),
    }));
  const tall = settings.format === 'png' && sheetHeight > TALL_PNG;

  async function run() {
    const element = sheet.current;
    if (!element || !items.length) return;
    setBusy(true);
    setError('');
    try {
      if (settings.format === 'png') {
        const result = await exportPng(element, settings, fileName);
        toast.show(`Se descargó ${fileName} (${result.width} × ${result.height} px).`);
      } else {
        const result = await exportPdf(element, settings, fileName, title);
        toast.show(`Se descargó ${fileName} (${result.pages} ${result.pages === 1 ? 'página' : 'páginas'}).`);
      }
      onClose();
    } catch {
      setError('No se pudo generar el archivo. Probá con menos contenido o con otra calidad.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Exportar" onClose={onClose} size="xl">
      <div className="export-layout">
        <div className="export-controls">
          <fieldset className="ex-group">
            <legend>Contenido</legend>
            <Segmented<'all' | 'current' | 'custom'>
              label="Atajos de contenido"
              value={preset}
              onChange={(value) => {
                if (value === 'all') setSelection((current) => ({ ...everything(notebook), scopes: current.scopes }));
                else if (value === 'current' && activeBlockId) setSelection((current) => ({ ...onlyBlock(activeBlockId), scopes: current.scopes }));
              }}
              options={[
                { value: 'all', label: 'Documento completo' },
                ...(activeBlockId ? [{ value: 'current' as const, label: 'Bloque actual' }] : []),
                ...(preset === 'custom' ? [{ value: 'custom' as const, label: 'Selección' }] : []),
              ]}
            />
            {notebook.blocks.length === 0 ? (
              <p className="muted small">Este cuaderno no tiene bloques para exportar.</p>
            ) : (
              <ul className="ex-blocks">
                {notebook.blocks.map((block, index) => (
                  <li key={block.id}>
                    <label className="check">
                      <input type="checkbox" checked={selection.included.includes(block.id)} onChange={() => toggleBlock(block.id)} />
                      <span className="ex-block-name">
                        <Icon name={blockMeta[block.kind].icon} size={14} /> {blockLabel(block, index)}
                      </span>
                    </label>
                    {block.kind === 'map' && selection.included.includes(block.id) && (
                      <select
                        className="ex-scope"
                        aria-label={`Qué exportar de ${blockLabel(block, index)}`}
                        value={selection.scopes[block.id] ?? 'each'}
                        onChange={(event) => setSelection((current) => ({ ...current, scopes: { ...current.scopes, [block.id]: event.target.value } }))}
                      >
                        <option value="each">{block.content.positions.length > 1 ? 'Cada posición por separado' : 'La posición'}</option>
                        <option value="complete">Mapa completo (todas las notas)</option>
                        {block.content.positions.length > 1 &&
                          block.content.positions.map((position) => (
                            <option key={position.id} value={`pos:${position.id}`}>
                              Solo «{position.name}»
                            </option>
                          ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <fieldset className="ex-group">
            <legend>Formato</legend>
            <Segmented<'png' | 'pdf'>
              label="Formato de archivo"
              value={settings.format}
              onChange={(format) => patch({ format, background: format === 'pdf' && settings.background === 'transparent' ? 'paper' : settings.background })}
              options={[
                { value: 'png', label: 'Imagen PNG' },
                { value: 'pdf', label: 'Documento PDF' },
              ]}
            />
          </fieldset>

          <button type="button" className="btn btn-link ex-toggle" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
            Presentación {advanced ? '▴' : '▾'}
          </button>
          {advanced && (
            <fieldset className="ex-group">
              <legend className="sr-only">Presentación</legend>
              <div className="ex-row">
                <span>Tema</span>
                <Segmented<'light' | 'dark'>
                  label="Tema de la exportación"
                  value={settings.theme}
                  onChange={(theme) => patch({ theme })}
                  options={[
                    { value: 'light', label: 'Claro' },
                    { value: 'dark', label: 'Oscuro' },
                  ]}
                />
              </div>
              <div className="ex-row">
                <span>Fondo</span>
                <Segmented<'paper' | 'white' | 'transparent'>
                  label="Fondo"
                  value={settings.background}
                  onChange={(background) => patch({ background })}
                  options={[
                    { value: 'paper', label: 'Papel' },
                    { value: 'white', label: 'Blanco' },
                    ...(settings.format === 'png' ? [{ value: 'transparent' as const, label: 'Transparente' }] : []),
                  ]}
                />
              </div>
              <label className="check">
                <input type="checkbox" checked={settings.title} onChange={(event) => patch({ title: event.target.checked })} />
                <span>Mostrar el título</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={settings.legend} onChange={(event) => patch({ legend: event.target.checked })} />
                <span>Mostrar la leyenda</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={settings.notes} onChange={(event) => patch({ notes: event.target.checked })} />
                <span>Mostrar anotaciones</span>
              </label>
              <div className="ex-row">
                <span>Calidad</span>
                <Segmented<'1' | '2' | '3'>
                  label="Calidad de la imagen"
                  value={String(settings.quality) as '1' | '2' | '3'}
                  onChange={(value) => patch({ quality: Number(value) as 1 | 2 | 3 })}
                  options={[
                    { value: '1', label: 'Estándar' },
                    { value: '2', label: 'Alta' },
                    { value: '3', label: 'Impresión' },
                  ]}
                />
              </div>
            </fieldset>
          )}
          <p className="ex-filename">
            Se guardará como <code>{fileName}</code>
          </p>
        </div>

        <div className="export-preview">
          <div className="ex-preview-head">
            <strong>Vista previa</strong>
            <span className="muted small">
              {items.length ? `${items.length} ${items.length === 1 ? 'elemento' : 'elementos'}` : 'Nada seleccionado'}
            </span>
          </div>
          <div ref={holder} className={`ex-preview-frame${settings.background === 'transparent' && settings.format === 'png' ? ' checker' : ''}`}>
            <div className="ex-preview-scale" style={{ height: sheetHeight * scale }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: SHEET_WIDTH }}>
                <ExportSheet ref={sheet} title={title} items={items} settings={settings} />
              </div>
            </div>
          </div>
          {tall && (
            <p className="notice warn" role="status">
              <Icon name="alert" size={16} />
              <span>
                Este contenido es muy alto para una sola imagen. En PNG saldrá una imagen muy larga: el PDF lo reparte en páginas, o exportá menos bloques.
              </span>
            </p>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="notice danger">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || !items.length} onClick={() => void run()}>
          {busy ? 'Preparando…' : `Descargar ${settings.format.toUpperCase()}`}
        </button>
      </div>
    </Dialog>
  );
}
