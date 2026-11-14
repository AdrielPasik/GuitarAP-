import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { libraryRepository } from '@/data/library-repository';
import { useLibrary } from '@/data/use-library';

export function LibraryScreen() {
  const { nodes, documents } = useLibrary();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const selectedNode = nodes.find((node) => node.id === folderId);
  const matches = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    const inFolder = selectedNode?.kind === 'song' ? documents.filter((item) => item.songId === selectedNode.id) : folderId ? documents.filter((item) => item.nodeId === folderId) : documents;
    return value ? inFolder.filter((item) => item.title.toLocaleLowerCase().includes(value)) : inFolder;
  }, [documents, folderId, query, selectedNode]);

  async function createDocument(type: 'tablature' | 'fretboard') {
    const document = await libraryRepository.createDocument(type, type === 'tablature' ? 'Nueva tablatura' : 'Nuevo diapasón', selectedNode?.kind === 'song' ? selectedNode.parentId : folderId, selectedNode?.kind === 'song' ? selectedNode.id : null);
    navigate(`/${type === 'tablature' ? 'tablaturas' : 'diapason'}/${document.id}`);
  }

  return (
    <section className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-5 dark:border-white/10">
        <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-700 dark:text-amber-300">Espacio de trabajo</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Biblioteca</h1></div>
        <div className="flex flex-wrap gap-2">
          <button className="control" onClick={() => { const name = window.prompt('Nombre de la carpeta'); if (name) void libraryRepository.createNode(name, 'folder', folderId); }}>+ Carpeta</button>
          <button className="control" onClick={() => { const name = window.prompt('Nombre de la canción'); if (name) void libraryRepository.createNode(name, 'song', folderId); }}>+ Canción</button>
          <button className="control" onClick={() => void createDocument('fretboard')}>+ Diapasón</button>
          <button className="control-primary" onClick={() => void createDocument('tablature')}>+ Tablatura</button>
        </div>
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-[220px_1fr]">
        <aside className="rounded-xl border border-stone-200 bg-white/65 p-3 dark:border-white/10 dark:bg-white/5">
          <p className="px-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Carpetas</p>
          <div className="mt-2 space-y-1"><button className={`w-full rounded-md px-2 py-2 text-left text-sm ${!folderId ? 'bg-amber-100 dark:bg-amber-900/30' : 'hover:bg-amber-50 dark:hover:bg-white/10'}`} onClick={() => setFolderId(null)}>⌂ Todo</button>{nodes.length ? nodes.map((node) => <div key={node.id} className="group flex items-center"><button onClick={() => setFolderId(node.id)} className={`min-w-0 flex-1 rounded-md px-2 py-2 text-left text-sm ${folderId === node.id ? 'bg-amber-100 dark:bg-amber-900/30' : 'hover:bg-amber-50 dark:hover:bg-white/10'}`}>{node.kind === 'song' ? '♫' : '⌁'} {node.name}</button><button aria-label={`Opciones de ${node.name}`} className="px-1 text-stone-400 opacity-0 group-hover:opacity-100" onClick={() => { const action = window.prompt('r=renombrar, d=duplicar, x=papelera'); if (action === 'r') { const name = window.prompt('Nuevo nombre', node.name); if (name) void libraryRepository.updateNode(node.id, { name }); } if (action === 'd') void libraryRepository.duplicateNode(node.id); if (action === 'x') void libraryRepository.trashNode(node.id); }}>•••</button></div>) : <p className="px-2 py-3 text-sm text-stone-500">Creá carpetas a tu medida.</p>}</div>
        </aside>
        <div>
          <label className="sr-only" htmlFor="search">Buscar documentos</label>
          {selectedNode?.kind === 'song' && <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/20"><strong>♫ {selectedNode.name}</strong><span className="ml-2 text-stone-500">Partes de la canción: {matches.length}. Creá tablaturas o diapasones para navegar cada parte.</span></div>}
          <input id="search" value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-600 dark:border-white/15 dark:bg-white/5" placeholder="Buscar tablaturas y diagramas…" />
          <div className="mt-4 grid gap-2 sm:grid-cols-2">{matches.length ? matches.map((document) => <div key={document.id} className="group rounded-xl border border-stone-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-sm dark:border-white/10 dark:bg-white/5"><button onClick={() => navigate(`/${document.type === 'tablature' ? 'tablaturas' : 'diapason'}/${document.id}`)} className="w-full text-left"><p className="text-xs font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300">{document.type === 'tablature' ? 'Tablatura' : 'Diapasón'}</p><p className="mt-1 font-semibold">{document.title}</p><p className="mt-3 text-xs text-stone-500">Modificado {new Date(document.updatedAt).toLocaleDateString('es-AR')}</p></button><div className="mt-3 flex gap-2 text-xs"><button onClick={() => void libraryRepository.duplicateDocument(document.id)}>Duplicar</button><button onClick={() => void libraryRepository.trashDocument(document.id)}>Papelera</button></div></div>) : <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500 dark:border-white/15">Todavía no hay documentos. Empezá con una tablatura o un diapasón.</div>}</div>
        </div>
      </div>
    </section>
  );
}
