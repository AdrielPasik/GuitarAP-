import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { belongsToOwner, libraryScope } from '@/data/library-scope';
import { pathOf } from '@/data/paths';
import { NotebookEditor } from '@/features/notebook/NotebookEditor';

/** Opens one material for editing. Old /tablaturas and /diapason links land here too. */
export function NotebookScreen() {
  const { id } = useParams();
  const [state, setState] = useState<{ document: MusicalDocument | null; location: string } | undefined>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const scope = await libraryScope();
      const found = id ? await db.documents.get(id) : undefined;
      const nodes = await db.nodes.toArray();
      if (!alive) return;
      const visible = found && belongsToOwner(found, scope) ? found : null;
      setState({ document: visible, location: visible ? pathOf(nodes, visible.songId ?? visible.nodeId) : '' });
    })();
    return () => {
      alive = false;
    };
  }, [id, reload]);

  if (!state) return <p className="route-fallback" role="status">Abriendo material…</p>;
  if (!state.document)
    return (
      <section className="not-found">
        <h1>No encontramos este material</h1>
        <p>Puede haberse movido a la papelera o pertenecer a otra cuenta.</p>
        <Link className="btn btn-primary" to="/biblioteca">
          Volver a la biblioteca
        </Link>
      </section>
    );
  return (
    <NotebookEditor
      key={`${state.document.id}:${reload}`}
      document={state.document}
      location={state.location}
      onRestored={() => setReload((value) => value + 1)}
    />
  );
}
