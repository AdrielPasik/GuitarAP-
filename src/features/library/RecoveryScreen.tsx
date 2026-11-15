import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/database';
import { libraryRepository } from '@/data/library-repository';
import { belongsToOwner, libraryScope } from '@/data/library-scope';
import { SyncPanel } from '@/features/sync/SyncPanel';

export function RecoveryScreen() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [selectedDocument, setSelectedDocument] = useState('');
  const data = useLiveQuery(async () => { const scope = await libraryScope(); const [documents, nodes, versions] = await Promise.all([db.documents.toArray(), db.nodes.toArray(), db.versions.where('documentId').equals(selectedDocument).toArray()]); return { documents: documents.filter((item) => belongsToOwner(item, scope)), deletedDocuments: documents.filter((item) => belongsToOwner(item, scope) && Boolean(item.deletedAt)), deletedNodes: nodes.filter((item) => belongsToOwner(item, scope) && Boolean(item.deletedAt)), versions: versions.filter((item) => belongsToOwner(item, scope)).sort((a, b) => b.createdAt - a.createdAt) }; }, [selectedDocument]) ?? { documents: [], deletedDocuments: [], deletedNodes: [], versions: [] };
  const activeDocuments = data.documents.filter((item) => !item.deletedAt);
  async function exportBackup() {
    const payload = await libraryRepository.exportBackup();
    const link = window.document.createElement('a');
    link.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    link.download = `guitarap-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage('Backup JSON exportado.');
  }
  async function importBackup(file: File) {
    try {
      const mode = window.confirm('Aceptar fusiona el backup. Cancelar reemplaza toda la biblioteca local.') ? 'merge' : 'replace';
      await libraryRepository.importBackup(await file.text(), mode);
      setMessage(mode === 'merge' ? 'Backup fusionado.' : 'Biblioteca reemplazada por el backup.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo importar el backup.'); }
  }
  return <section className="mx-auto max-w-5xl">
    <div className="border-b border-stone-200 pb-5 dark:border-white/10"><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-700 dark:text-amber-300">Datos locales</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Historial y backups</h1><p className="mt-2 text-sm text-stone-500">Restaurá versiones, recuperá elementos de la papelera y administrá backups JSON sin enviar datos a un servicio externo.</p></div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2"><div className="lg:col-span-2"><SyncPanel /></div><section className="rounded-xl border border-stone-200 bg-white/65 p-4 dark:border-white/10 dark:bg-white/5"><h2 className="font-semibold">Backup de biblioteca</h2><p className="mt-1 text-sm text-stone-500">Incluye carpetas, canciones, documentos y versiones.</p><div className="mt-4 flex flex-wrap gap-2"><button className="control-primary" onClick={() => void exportBackup()}>Exportar JSON</button><button className="control" onClick={() => fileInput.current?.click()}>Importar JSON</button><input ref={fileInput} aria-label="Archivo de backup" type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); event.currentTarget.value = ''; }} /></div>{message && <p role="status" className="mt-3 text-sm text-amber-700">{message}</p>}</section>
      <section className="rounded-xl border border-stone-200 bg-white/65 p-4 dark:border-white/10 dark:bg-white/5"><h2 className="font-semibold">Papelera</h2>{data.deletedDocuments.length + data.deletedNodes.length ? <div className="mt-3 space-y-2 text-sm">{data.deletedDocuments.map((item) => <div key={item.id} className="flex items-center justify-between gap-2"><span>{item.title}</span><button className="control" onClick={() => void libraryRepository.restoreDocument(item.id)}>Restaurar</button></div>)}{data.deletedNodes.map((item) => <div key={item.id} className="flex items-center justify-between gap-2"><span>{item.kind === 'song' ? '♫' : '⌁'} {item.name}</span><button className="control" onClick={() => void libraryRepository.restoreNode(item.id)}>Restaurar</button></div>)}</div> : <p className="mt-3 text-sm text-stone-500">La papelera está vacía.</p>}</section>
      <section className="rounded-xl border border-stone-200 bg-white/65 p-4 dark:border-white/10 dark:bg-white/5 lg:col-span-2"><h2 className="font-semibold">Versiones de documento</h2><div className="mt-3 flex flex-wrap gap-2"><select aria-label="Documento con historial" className="control" value={selectedDocument} onChange={(event) => setSelectedDocument(event.target.value)}><option value="">Elegí un documento…</option>{activeDocuments.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>{selectedDocument && <span className="self-center text-xs text-stone-500">Cada restauración preserva antes una versión de seguridad.</span>}</div>{selectedDocument && <div className="mt-4 space-y-2">{data.versions.length ? data.versions.map((version) => <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-stone-200 p-3 text-sm dark:border-white/10"><span><strong>{version.title}</strong> · {version.reason} · {new Date(version.createdAt).toLocaleString('es-AR')}</span><button className="control" onClick={() => void libraryRepository.restoreVersion(selectedDocument, version.id)}>Restaurar esta versión</button></div>) : <p className="text-sm text-stone-500">Aún no hay versiones guardadas para este documento.</p>}</div>}</section>
    </div>
  </section>;
}
