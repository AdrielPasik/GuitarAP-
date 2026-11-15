import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/database';
import { libraryRepository } from '@/data/library-repository';
import { belongsToOwner, libraryScope } from '@/data/library-scope';
import { SyncPanel } from '@/features/sync/SyncPanel';
import { describeBackup, downloadBackup } from '@/features/backup/backup-download';

export function RecoveryScreen() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [exporting, setExporting] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState('');
  const data = useLiveQuery(async () => {
    const scope = await libraryScope();
    const [documents, nodes, versions] = await Promise.all([
      db.documents.toArray(),
      db.nodes.toArray(),
      db.versions.where('documentId').equals(selectedDocument).toArray(),
    ]);
    return {
      documents: documents.filter((item) => belongsToOwner(item, scope)),
      deletedDocuments: documents.filter(
        (item) => belongsToOwner(item, scope) && Boolean(item.deletedAt),
      ),
      deletedNodes: nodes.filter((item) => belongsToOwner(item, scope) && Boolean(item.deletedAt)),
      versions: versions
        .filter((item) => belongsToOwner(item, scope))
        .sort((a, b) => b.createdAt - a.createdAt),
    };
  }, [selectedDocument]) ?? { documents: [], deletedDocuments: [], deletedNodes: [], versions: [] };
  const activeDocuments = data.documents.filter((item) => !item.deletedAt);
  async function exportBackup() {
    setExporting(true);
    setErrorMessage('');
    setMessage('');
    try {
      const payload = await libraryRepository.exportBackup();
      const summary = downloadBackup(payload);
      setMessage(`Descarga iniciada con ${describeBackup(summary)}.`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo exportar el backup. Tus datos locales no fueron modificados.',
      );
    } finally {
      setExporting(false);
    }
  }
  async function importBackup(file: File) {
    try {
      const mode = window.confirm(
        'Aceptar fusiona el backup. Cancelar reemplaza toda la biblioteca local.',
      )
        ? 'merge'
        : 'replace';
      await libraryRepository.importBackup(await file.text(), mode);
      setMessage(mode === 'merge' ? 'Backup fusionado.' : 'Biblioteca reemplazada por el backup.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo importar el backup.');
    }
  }
  return (
    <section className="settings-shell mx-auto max-w-5xl">
      <div className="settings-heading">
        <p className="eyebrow">Cuenta, datos y preferencias</p>
        <h1>Configuración</h1>
        <p className="mt-2 text-sm text-stone-500">
          Administrá la nube y las copias locales en áreas separadas y seguras.
        </p>
      </div>
      <div className="settings-grid">
        <div className="settings-area lg:col-span-2">
          <span className="settings-area-label">Cuenta y sincronización</span>
          <SyncPanel />
        </div>
        <section className="settings-area">
          <span className="settings-area-label">Copias de seguridad</span>
          <h2 className="font-semibold">Backup de biblioteca</h2>
          <p className="mt-1 text-sm text-stone-500">
            Incluye carpetas, canciones, documentos y versiones.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="control-primary"
              disabled={exporting}
              onClick={() => void exportBackup()}
            >
              {exporting ? 'Preparando JSON…' : 'Exportar JSON'}
            </button>
            <button className="control" onClick={() => fileInput.current?.click()}>
              Importar JSON
            </button>
            <input
              ref={fileInput}
              aria-label="Archivo de backup"
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importBackup(file);
                event.currentTarget.value = '';
              }}
            />
          </div>
          {errorMessage && (
            <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
              {errorMessage}
            </p>
          )}
          {message && (
            <p role="status" className="mt-3 text-sm text-amber-700 dark:text-amber-300">
              {message}
            </p>
          )}
        </section>
        <section className="settings-area">
          <span className="settings-area-label">Recuperación</span>
          <h2 className="font-semibold">Papelera</h2>
          {data.deletedDocuments.length + data.deletedNodes.length ? (
            <div className="mt-3 space-y-2 text-sm">
              {data.deletedDocuments.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2">
                  <span>{item.title}</span>
                  <button
                    className="control"
                    onClick={() => void libraryRepository.restoreDocument(item.id)}
                  >
                    Restaurar
                  </button>
                </div>
              ))}
              {data.deletedNodes.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2">
                  <span>
                    {item.kind === 'song' ? '♫' : '⌁'} {item.name}
                  </span>
                  <button
                    className="control"
                    onClick={() => void libraryRepository.restoreNode(item.id)}
                  >
                    Restaurar
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-stone-500">La papelera está vacía.</p>
          )}
        </section>
        <section className="settings-area lg:col-span-2">
          <span className="settings-area-label">Historial</span>
          <h2 className="font-semibold">Versiones de documento</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              aria-label="Documento con historial"
              className="control"
              value={selectedDocument}
              onChange={(event) => setSelectedDocument(event.target.value)}
            >
              <option value="">Elegí un documento…</option>
              {activeDocuments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            {selectedDocument && (
              <span className="self-center text-xs text-stone-500">
                Cada restauración preserva antes una versión de seguridad.
              </span>
            )}
          </div>
          {selectedDocument && (
            <div className="mt-4 space-y-2">
              {data.versions.length ? (
                data.versions.map((version) => (
                  <div
                    key={version.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded border border-stone-200 p-3 text-sm dark:border-white/10"
                  >
                    <span>
                      <strong>{version.title}</strong> · {version.reason} ·{' '}
                      {new Date(version.createdAt).toLocaleString('es-AR')}
                    </span>
                    <button
                      className="control"
                      onClick={() =>
                        void libraryRepository.restoreVersion(selectedDocument, version.id)
                      }
                    >
                      Restaurar esta versión
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-stone-500">
                  Aún no hay versiones guardadas para este documento.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
