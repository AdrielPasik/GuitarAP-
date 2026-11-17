import { createContext, useContext, useState } from 'react';
import type { NoteComment } from '@/core/model';
import { Icon } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';

/**
 * Personal annotations. They live in the notebook (so they travel with backups, history and sync) and point at
 * blocks and musical events by id. Deleting offers Undo; a removed block takes its comments with it.
 */
export type CommentsApi = {
  all: NoteComment[];
  add: (target: { blockId?: string; eventId?: string }, text: string) => void;
  edit: (id: string, text: string) => void;
  remove: (id: string) => void;
  readOnly: boolean;
};
export const CommentsContext = createContext<CommentsApi>({ all: [], add: () => undefined, edit: () => undefined, remove: () => undefined, readOnly: true });
export const useComments = () => useContext(CommentsContext);

const dateLabel = (time: number) => new Date(time).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });

function Thread({ target, label, onDone }: { target: { blockId?: string; eventId?: string }; label: string; onDone?: () => void }) {
  const api = useComments();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const list = api.all.filter((comment) => comment.blockId === target.blockId && comment.eventId === target.eventId);
  const submit = () => {
    const value = draft.trim();
    if (!value) return;
    api.add(target, value);
    setDraft('');
  };
  return (
    <div className="comment-thread" role="group" aria-label={`Comentarios de ${label}`}>
      {list.length === 0 && <p className="muted small">Todavía no hay comentarios{api.readOnly ? '.' : '. Anotá una idea para acordarte.'}</p>}
      <ul>
        {list.map((comment) => (
          <li key={comment.id} className="comment">
            {editing === comment.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (text.trim()) api.edit(comment.id, text.trim());
                  setEditing(null);
                }}
              >
                <textarea aria-label="Editar comentario" autoFocus rows={2} value={text} onChange={(event) => setText(event.target.value)} />
                <div className="comment-actions">
                  <button type="submit" className="btn btn-primary">Guardar</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancelar</button>
                </div>
              </form>
            ) : (
              <>
                <p>{comment.text}</p>
                <div className="comment-meta">
                  <span className="muted small">
                    {dateLabel(comment.createdAt)}
                    {comment.updatedAt !== comment.createdAt ? ` · editado ${dateLabel(comment.updatedAt)}` : ''}
                  </span>
                  {!api.readOnly && (
                    <span className="comment-actions">
                      <button type="button" className="btn btn-link" onClick={() => { setEditing(comment.id); setText(comment.text); }}>Editar</button>
                      <button type="button" className="btn btn-link danger" onClick={() => api.remove(comment.id)}>Eliminar</button>
                    </span>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {!api.readOnly && (
        <form
          className="comment-new"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
            onDone?.();
          }}
        >
          <textarea
            aria-label={`Nuevo comentario sobre ${label}`}
            rows={2}
            placeholder="Escribí un comentario…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>Agregar comentario</button>
        </form>
      )}
    </div>
  );
}

/** A quiet indicator: shows a count when there are comments, opens a small panel to read and write them. */
export function CommentButton({
  blockId,
  eventId,
  label,
  className = 'icon-btn',
  forceVisible = false,
}: {
  blockId?: string;
  eventId?: string;
  label: string;
  className?: string;
  forceVisible?: boolean;
}) {
  const api = useComments();
  const count = api.all.filter((comment) => comment.blockId === blockId && comment.eventId === eventId).length;
  if (api.readOnly && count === 0 && !forceVisible) return null;
  return (
    <Popover
      label={`Comentarios de ${label}`}
      align="end"
      triggerClassName={`${className}${count ? ' has-comments' : ''}`}
      trigger={
        <>
          <Icon name="comment" size={14} />
          {count > 0 && <span className="comment-count">{count}</span>}
        </>
      }
    >
      {() => <Thread target={{ blockId, eventId }} label={label} />}
    </Popover>
  );
}
