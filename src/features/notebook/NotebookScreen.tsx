import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { belongsToOwner, libraryScope } from '@/data/library-scope';
import { pathOf } from '@/data/paths';
import { useVisible } from '@/data/use-visible';
import { NotebookEditor } from '@/features/notebook/NotebookEditor';

/** Opens one material for editing. Old /tablaturas and /diapason links land here too. */
export function NotebookScreen() {
  const { id } = useParams();
  const visible = useVisible();
  const [state, setState] = useState<{ epoch: number; document: MusicalDocument | null; location: string } | undefined>();
  const [reload, setReload] = useState(0);

  const epoch = visible?.epoch;
  useEffect(() => {
    if (epoch === undefined) return;
    let alive = true;
    void (async () => {
      const scope = await libraryScope();
      const found = id ? await db.documents.get(id) : undefined;
      const nodes = await db.nodes.toArray();
      // A read that started for one person must never be shown after another one took over.
      const after = await libraryScope();
      if (!alive || after.epoch !== scope.epoch || after.ownerId !== scope.ownerId) return;
      const mine = found && belongsToOwner(found, scope) ? found : null;
      setState({ epoch: scope.epoch, document: mine, location: mine ? pathOf(nodes.filter((node) => belongsToOwner(node, scope)), mine.songId ?? mine.nodeId) : '' });
    })();
    return () => {
      alive = false;
    };
  }, [id, reload, epoch]);

  if (!state || state.epoch !== epoch) return <p className="route-fallback" role="status">Abriendo material…</p>;
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
