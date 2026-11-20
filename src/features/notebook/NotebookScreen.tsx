import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { MusicalDocument } from '@/core/model';
import { db } from '@/data/database';
import { deleteDraft, readDraft, type Draft } from '@/data/drafts';
import { libraryRepository, type EditTicket } from '@/data/library-repository';
import { belongsToOwner, libraryScope } from '@/data/library-scope';
import { pathOf } from '@/data/paths';
import { useVisible } from '@/data/use-visible';
import { NotebookEditor } from '@/features/notebook/NotebookEditor';

/** Opens one material for editing. Old /tablaturas and /diapason links land here too. */
export function NotebookScreen() {
  const { id } = useParams();
  const visible = useVisible();
  const [state, setState] = useState<{ epoch: number; document: MusicalDocument | null; location: string; ticket?: EditTicket; draft?: Draft } | undefined>();
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
      const ticket = mine ? await libraryRepository.openForEdit(mine).catch(() => undefined) : undefined;
      let draft = mine ? await readDraft(mine.id, scope) : undefined;
      // A journal entry that equals what is stored is just a leftover of a save that succeeded: not something to offer.
      if (mine && draft && draft.title === mine.title && JSON.stringify(draft.content) === JSON.stringify(mine.content)) {
        await deleteDraft(draft.ownerId, mine.id);
        draft = undefined;
      }
      const still = await libraryScope();
      if (!alive || still.epoch !== scope.epoch) return;
      setState({ epoch: scope.epoch, document: mine, location: mine ? pathOf(nodes.filter((node) => belongsToOwner(node, scope)), mine.songId ?? mine.nodeId) : '', ticket, draft });
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
  const { document, draft } = state;
  return (
    <>
      {draft && (
        <p className="local-note draft-note" role="alert">
          <span>
            Hay cambios de tu cuenta sin guardar en este material ({new Date(draft.savedAt).toLocaleString('es-AR')}). Quedaron a salvo como borrador.
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              void (async () => {
                // A recovery point of the current version is left first (saveDocument does it); nothing is overwritten silently.
                await libraryRepository.saveDocument({ ...document, title: draft.title, content: draft.content as MusicalDocument['content'] }, 'manual');
                await deleteDraft(draft.ownerId, document.id);
                setReload((value) => value + 1);
              })()
            }
          >
            Recuperar los cambios
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void (async () => {
                await deleteDraft(draft.ownerId, document.id);
                setReload((value) => value + 1);
              })()
            }
          >
            Descartar el borrador
          </button>
        </p>
      )}
      <NotebookEditor
        key={`${document.id}:${reload}:${document.rev}`}
        document={document}
        location={state.location}
        ticket={state.ticket}
        onRestored={() => setReload((value) => value + 1)}
      />
    </>
  );
}
