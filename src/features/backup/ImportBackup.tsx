import { useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { applyImport, ImportChangedError, listImports, previewImport, undoImport, type ImportLedger, type Preview } from '@/data/backup-import';
import { libraryRepository } from '@/data/library-repository';
import { downloadBackup } from '@/features/backup/backup-download';
import { BackupError } from '@/features/backup/backup-schema';
import { useLiveQuery } from 'dexie-react-hooks';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Import a backup in four calm steps: choose the file, read what it holds and what would happen, confirm, see the
 * result (with a way back). Nothing is written until the person confirms, and nothing that exists is ever replaced.
 */
export function ImportBackup() {
  const file = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ ledger: ImportLedger; extra?: string } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [foreignOk, setForeignOk] = useState(false);
  const [copyFirst, setCopyFirst] = useState(true);
  const imports = useLiveQuery(() => listImports(), [result, message]);

  async function choose(selected: File) {
    setError('');
    setMessage('');
    setResult(null);
    setForeignOk(false);
    setCopyFirst(true);
    try {
      setPreview(await previewImport(await selected.text(), selected.name));
    } catch (problem) {
      setPreview(null);
      setError(problem instanceof BackupError ? problem.message : 'No pudimos leer ese archivo como una copia de GuitarAP. No se tocó nada.');
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      // A copy of what is here now goes first, as an ordinary download: the way back that does not depend on this app.
      if (copyFirst) downloadBackup(await libraryRepository.exportBackup());
      const ledger = await applyImport(preview, { foreign: foreignOk });
      setResult({ ledger });
      setPreview(null);
    } catch (problem) {
      setError(
        problem instanceof ImportChangedError || problem instanceof Error
          ? problem.message
          : 'No se pudo importar la copia. No se importó nada: tu biblioteca quedó como estaba.',
      );
      if (problem instanceof ImportChangedError) setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function undo(id: string) {
    setError('');
    try {
      const undone = await undoImport(id);
      setMessage(`Se deshizo la importación: ${plural(undone.documents, 'material', 'materiales')} y ${plural(undone.folders, 'carpeta o canción', 'carpetas o canciones')} se enviaron a la papelera${undone.keptFolders ? ` (${plural(undone.keptFolders, 'carpeta se dejó', 'carpetas se dejaron')} porque ahora contienen material tuyo)` : ''}. El historial no se tocó y todo se puede restaurar desde la papelera.`);
      setResult(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No se pudo deshacer la importación.');
    }
  }

  const plan = preview?.plan;
  const summary = plan?.summary;
  const nothing = Boolean(summary) && summary!.willWrite === 0;
  return (
    <>
      <button type="button" className="btn" onClick={() => file.current?.click()}>
        Importar una copia…
      </button>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Archivo de copia de seguridad"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          if (selected) void choose(selected);
          event.currentTarget.value = '';
        }}
      />
      {error && (
        <p role="alert" className="notice danger">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </p>
      )}
      {message && (
        <p role="status" className="notice ok">
          <Icon name="check" size={16} />
          <span>{message}</span>
        </p>
      )}
      {result && (
        <section className="notice ok import-result" role="status" aria-label="Resultado de la importación">
          <Icon name="check" size={16} />
          <span>
            <strong>La copia se importó.</strong> Se agregaron {plural(result.ledger.summary.added.folders + result.ledger.summary.added.songs, 'carpeta o canción', 'carpetas y canciones')}, {plural(result.ledger.summary.added.documents, 'material', 'materiales')}
            {result.ledger.summary.copies.documents ? `, ${plural(result.ledger.summary.copies.documents, 'copia de un material que ya existía', 'copias de materiales que ya existían')}` : ''} y {plural(result.ledger.summary.added.versions, 'versión', 'versiones')} del historial.
            {' '}No se reemplazó nada. Si no era lo que querías podés deshacerlo: lo importado va a la papelera y nada se borra.
          </span>
          <button type="button" className="btn" onClick={() => void undo(result.ledger.id)}>
            Deshacer esta importación
          </button>
        </section>
      )}
      {!result && imports && imports.some((item) => !item.undoneAt) && (
        <details className="import-history">
          <summary>Importaciones anteriores</summary>
          <ul>
            {imports.slice(0, 5).map((item) => (
              <li key={item.id}>
                {new Date(item.at).toLocaleString('es-AR')} · {item.fileName} · {plural(item.documents.length, 'material', 'materiales')}
                {item.undoneAt ? ' · deshecha' : ''}
                {!item.undoneAt && (
                  <button type="button" className="btn btn-link" onClick={() => void undo(item.id)}>
                    Deshacer
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {preview && summary && plan && (
        <Dialog title="Importar copia de seguridad" onClose={() => setPreview(null)}>
          <div className="stack">
            <p>
              <strong>{preview.fileName}</strong> contiene {plural(summary.inFile.folders, 'carpeta', 'carpetas')}, {plural(summary.inFile.songs, 'canción', 'canciones')}, {plural(summary.inFile.documents, 'documento', 'documentos')} y {plural(summary.inFile.versions, 'versión', 'versiones')}.
            </p>
            <p className="muted small">Todavía no se escribió nada. Esto es lo que pasaría si importás:</p>
            <dl className="import-summary" aria-label="Qué se importaría">
              <div><dt>Nuevo</dt><dd>{summary.added.folders + summary.added.songs} carpetas y canciones · {summary.added.documents} documentos · {summary.added.versions} versiones</dd></div>
              <div><dt>Ya existe y es idéntico (se omite)</dt><dd>{summary.identical.documents} documentos · {summary.identical.versions} versiones</dd></div>
              <div><dt>Ya existe pero es distinto</dt><dd>{summary.copies.documents} documentos: el tuyo se queda como está y esta versión entra como una copia identificada</dd></div>
              {summary.copies.lookOlder > 0 && <div><dt>Posiblemente más antiguo</dt><dd>{summary.copies.lookOlder} de esas copias parecen más viejas que lo que ya tenés</dd></div>}
              {summary.existingFolders > 0 && <div><dt>Carpetas que ya existen</dt><dd>{summary.existingFolders}: se dejan como están y su contenido nuevo se coloca adentro</dd></div>}
              {summary.relocated > 0 && <div><dt>Sin su carpeta</dt><dd>{summary.relocated} elementos apuntaban a una carpeta que no está en la copia: van al nivel principal</dd></div>}
              <div><dt>Registros inválidos (se omiten)</dt><dd>{summary.invalid}</dd></div>
            </dl>
            {preview.parsed.invalid.length > 0 && (
              <details>
                <summary>Ver por qué se omiten</summary>
                <ul className="small">
                  {preview.parsed.invalid.slice(0, 10).map((item, index) => (
                    <li key={index}>{item.kind}: {item.reason}</li>
                  ))}
                </ul>
              </details>
            )}
            {preview.parsed.extras.length > 0 && <p className="muted small">La copia también trae {preview.parsed.extras.join(', ')}: esta versión todavía no lo importa, y no se pierde nada por eso.</p>}
            {plan.foreign && (
              <div className="notice warn" role="note">
                <Icon name="alert" size={16} />
                <span>
                  <strong>Esta copia pertenece a otra cuenta.</strong> No modifica nada de esta cuenta y no conserva ninguna referencia a la original: todo entra como copias tuyas, con identificadores nuevos.
                </span>
              </div>
            )}
            {plan.foreign && (
              <label className="check">
                <input type="checkbox" checked={foreignOk} onChange={(event) => setForeignOk(event.target.checked)} />
                <span>Entiendo: se importa como copias propias de esta cuenta.</span>
              </label>
            )}
            {nothing ? (
              <p role="status">No hay nada para importar: todo lo que trae ya está en tu biblioteca{summary.invalid ? ' (salvo los registros inválidos)' : ''}.</p>
            ) : (
              <label className="check">
                <input type="checkbox" checked={copyFirst} onChange={(event) => setCopyFirst(event.target.checked)} />
                <span>Descargar antes una copia de mi biblioteca actual (recomendado)</span>
              </label>
            )}
            <p className="muted small">Importar solo agrega. Nunca reemplaza ni borra nada de lo que tenés, y después podés deshacerlo.</p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setPreview(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={busy || nothing || (plan.foreign && !foreignOk)} onClick={() => void confirm()}>
                {busy ? 'Importando…' : 'Importar'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
