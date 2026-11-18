import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { StudioScene } from '@/components/art/Art';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast-context';
import type { NotebookContent } from '@/core/model';
import { addComment } from '@/core/notebook';
import { useUndoRedo } from '@/core/use-undo-redo';
import { db, type SharedCopy } from '@/data/database';
import { libraryRepository } from '@/data/library-repository';
import { useAccount } from '@/features/account/account-context';
import { NotebookBlocks } from '@/features/notebook/NotebookBlocks';
import { collabApi, CollabError, type ActivityEntry, type Role } from '@/features/share/collab-api';
import { pullShared, pushShared, type SyncStatus } from '@/features/share/shared-sync';
import { useCollabState, useGateway } from '@/features/share/use-collab';
import type { Conflict } from '@/core/merge';

const ROLE_LABEL: Record<string, string> = { owner: 'Propietario', editor: 'Editor', commenter: 'Comentarista', viewer: 'Lector' };

/** Someone opened an invitation link: sign in with an existing account and accept. Nothing is granted until they do. */
export function AcceptInviteScreen() {
  const { token = '' } = useParams();
  const account = useAccount();
  const gateway = useGateway();
  const state = useCollabState();
  const navigate = useNavigate();
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function accept() {
    if (!gateway) return;
    setBusy(true);
    try {
      const result = await collabApi.acceptInvite(gateway, token, label);
      if (!result.ok) {
        setMessage(result.reason === 'own_project' ? 'Esta invitación es de un proyecto tuyo.' : 'La invitación no es válida: venció, ya se usó o fue revocada. Pedí una nueva.');
      } else navigate(result.kind === 'document' && result.id ? `/compartido/${result.id}` : '/compartidos', { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo aceptar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="guest-card scenic" aria-labelledby="invite-title">
      <StudioScene variant="compact" />
      <p className="hero-kicker">Invitación</p>
      <h1 id="invite-title">Te invitaron a colaborar en una canción</h1>
      {state === 'unavailable' && <p role="alert">Compartir todavía no está activado en esta instalación.</p>}
      {state === 'unconfigured' && <p role="alert">Esta versión no tiene la nube conectada.</p>}
      {state === 'ready' && !account.session && (
        <>
          <p>Para aceptar necesitás iniciar sesión con tu cuenta de GuitarAP. No creamos cuentas desde acá.</p>
          <button type="button" className="btn btn-primary" onClick={() => account.openDialog('sign-in')}>Iniciar sesión</button>
        </>
      )}
      {state === 'ready' && account.session && (
        <form className="guest-form" onSubmit={(event) => { event.preventDefault(); void accept(); }}>
          <label className="field">
            <span>¿Cómo querés aparecer? (el propietario no ve tu correo)</span>
            <input aria-label="Tu nombre para el proyecto" value={label} placeholder="Goti" onChange={(event) => setLabel(event.target.value)} />
          </label>
          {message && <p className="share-error" role="alert">{message}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>Aceptar invitación</button>
        </form>
      )}
    </section>
  );
}

/** Everything shared with this account: titles and roles. The music is fetched only when one is opened. */
export function SharedListScreen() {
  const gateway = useGateway();
  const account = useAccount();
  const state = useCollabState();
  const [data, setData] = useState<Awaited<ReturnType<typeof collabApi.sharedWithMe>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (state !== 'ready' || !gateway?.accessToken) return;
    let live = true;
    collabApi.sharedWithMe(gateway).then((value) => live && setData(value)).catch((failure) => live && setError(failure instanceof Error ? failure.message : 'No se pudo cargar.'));
    return () => {
      live = false;
    };
  }, [gateway, state]);
  return (
    <section className="shared-list">
      <header className="shared-head"><h1>Compartidos conmigo</h1><p className="muted">Proyectos de otras personas a los que te dieron acceso.</p></header>
      {state === 'unavailable' && <p role="alert">Compartir todavía no está activado en esta instalación.</p>}
      {state === 'ready' && !account.session && <p>Iniciá sesión para ver lo que te compartieron.</p>}
      {error && <p className="share-error" role="alert">{error}</p>}
      {data && data.documents.length === 0 && data.folders.length === 0 && (
        <div className="lib-empty scenic"><StudioScene variant="compact" /><h2>Todavía no te compartieron nada</h2><p>Cuando alguien te invite a un proyecto, aparece acá.</p></div>
      )}
      {data && (
        <ul className="lib-list" aria-label="Proyectos compartidos conmigo">
          {data.folders.map((folder) => (<li key={folder.id} className="lib-row"><span className="lib-open"><span className="glyph kind-folder"><Icon name="folder" size={16} /></span><span className="lib-title">{folder.name}</span><span className="lib-meta">Carpeta · {ROLE_LABEL[folder.role]}</span></span></li>))}
          {data.documents.map((doc) => (
            <li key={doc.id} className="lib-row">
              <Link className="lib-open" to={`/compartido/${doc.id}`}>
                <span className="glyph kind-song"><Icon name="users" size={16} /></span>
                <span className="lib-title">{doc.title || 'Sin título'}</span>
                <span className="lib-meta">{ROLE_LABEL[doc.role]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STATUS_TEXT: Record<SyncStatus | 'idle' | 'saving', string> = {
  idle: 'Guardado', saving: 'Guardando…', synced: 'Guardado', merged: 'Combinado con los cambios de la otra persona', offline: 'Sin conexión: tus cambios se guardan acá y se suben después', revoked: 'Sin acceso',
};

/**
 * A song somebody else owns, edited (or read, or commented on) according to my role. The copy lives on this device,
 * so it keeps working offline; changes are merged with the other person's by block and uploaded with a revision
 * check, so nobody's work is overwritten silently.
 */
export function SharedNotebookScreen() {
  const { id = '' } = useParams();
  const gateway = useGateway();
  const account = useAccount();
  const toast = useToast();
  const navigate = useNavigate();
  const state = useCollabState();
  const userId = account.session?.user.id ?? '';
  const [copy, setCopy] = useState<SharedCopy | null>(null);
  const [status, setStatus] = useState<SyncStatus | 'idle' | 'saving'>('idle');
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [problem, setProblem] = useState('');
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const empty = useMemo<NotebookContent>(() => ({ kind: 'notebook', version: 1, blocks: [] }), []);
  const history = useUndoRedo<NotebookContent>(empty);
  const copyRef = useRef<SharedCopy | null>(null);
  const busy = useRef(false);
  const ready = useRef(false);

  const persist = useCallback(async (next: SharedCopy) => {
    copyRef.current = next;
    setCopy(next);
    await db.shared.put(next);
  }, []);

  const sync = useCallback(async () => {
    if (!gateway?.accessToken || !userId || busy.current) return;
    busy.current = true;
    try {
      const api = collabApi;
      const before = copyRef.current;
      const pulled = await pullShared(api, gateway, before, id, userId);
      if (pulled.copy) {
        // What comes from the other person is not an edit of mine: it replaces the view without becoming an undo step.
        if (!before || pulled.status === 'merged' || pulled.copy.baseRev !== before.baseRev) history.reset(pulled.copy.content);
        await persist(pulled.copy);
      }
      if (pulled.status === 'revoked') {
        setStatus('revoked');
        setProblem(pulled.message ?? 'Ya no tenés acceso.');
        return;
      }
      if (pulled.status === 'offline') return setStatus('offline');
      let working = pulled.copy;
      const found = [...pulled.conflicts];
      if (working && working.dirty && (working.role === 'editor' || working.role === 'owner')) {
        const pushed = await pushShared(api, gateway, working);
        if (pushed.copy) {
          working = pushed.copy;
          if (pushed.status === 'merged') history.reset(pushed.copy.content);
          await persist(pushed.copy);
        }
        found.push(...pushed.conflicts);
        if (pushed.status === 'revoked') {
          setStatus('revoked');
          setProblem(pushed.message ?? 'Ya no tenés permiso para editar.');
          return;
        }
        setStatus(pushed.status === 'offline' ? 'offline' : pushed.status);
      } else setStatus(pulled.status);
      if (found.length) setConflicts((current) => [...current, ...found]);
    } finally {
      busy.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, id, userId, persist]);

  // Load: local copy first (works offline), then the server. It runs again when the session token arrives, because
  // after a reload the token can come later than the local copy (a sync without a token does nothing).
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void (async () => {
      const local = await db.shared.get(id);
      if (!live) return;
      // Only seed from disk when nothing is in memory yet: a second run of this effect must not overwrite a copy that a
      // sync has already refreshed (that is how a role change by the owner used to be lost after a reload).
      if (local && local.userId === userId && copyRef.current?.id !== id) {
        copyRef.current = local;
        setCopy(local);
        history.reset(local.content);
      }
      ready.current = true;
      await sync();
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, userId, state === 'ready', gateway?.accessToken]);

  // Keep following the other person while the tab is open.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void sync();
    }, 12000);
    return () => window.clearInterval(timer);
  }, [sync]);

  const role = copy?.role ?? 'viewer';
  const canEdit = role === 'editor' || role === 'owner';
  const lastWritten = useRef<NotebookContent | null>(null);
  // Autosave: every change is kept on this device first, then uploaded.
  useEffect(() => {
    const current = copyRef.current;
    if (!current || !canEdit || !ready.current) return;
    if (history.value === current.content || history.value === lastWritten.current) return;
    lastWritten.current = history.value;
    const timer = window.setTimeout(() => {
      void persist({ ...current, content: history.value, dirty: true, updatedAt: Date.now() }).then(() => {
        setStatus('saving');
        void sync();
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [history.value, canEdit, persist, sync]);

  function addRemoteComment(target: { blockId?: string; eventId?: string }, text: string) {
    if (!gateway || !copy) return;
    const { comment } = addComment(copy.content, target, text);
    void collabApi.comment(gateway, id, comment).then(() => sync()).catch((error: unknown) => toast.show(error instanceof Error ? error.message : 'No se pudo enviar el comentario.'));
  }

  async function keepMine() {
    if (!copy) return;
    const created = await libraryRepository.createStudyMaterial(`${copy.localTitle || copy.title} (mi copia)`);
    // What is on screen, not what autosave last wrote: an edit typed less than a moment ago must not be lost.
    await libraryRepository.saveDocument({ ...created, content: canEdit ? history.value : copy.content });
    toast.show('Guardé tu copia en tu biblioteca.');
    navigate(`/material/${created.id}`);
  }

  if (state === 'unavailable') return <section className="guest-card"><h1>Compartir todavía no está activado</h1><p>No se puede abrir este proyecto.</p></section>;
  if (!userId) return <section className="guest-card"><h1>Iniciá sesión</h1><p>Para abrir un proyecto compartido necesitás tu cuenta.</p><button type="button" className="btn btn-primary" onClick={() => account.openDialog('sign-in')}>Iniciar sesión</button></section>;
  if (!copy) return <p className="route-fallback" role="status">{status === 'revoked' ? problem : 'Abriendo el proyecto compartido…'}</p>;

  return (
    <section className="notebook shared-notebook" aria-label={`Proyecto compartido: ${copy.title}`}>
      <header className="doc-head">
        <Link className="back-link" to="/compartidos"><Icon name="chevron-left" size={16} /><span>Compartidos conmigo</span></Link>
        <h1 className="doc-title shared-title">{copy.title}</h1>
        <span className="doc-kind" title="Tu rol en este proyecto"><Icon name="users" size={13} /> {ROLE_LABEL[role]}</span>
        <div className="doc-actions">
          <span className={`save-state ${status === 'saving' ? 'saving' : status === 'revoked' ? 'error' : 'saved'}`} role="status">{STATUS_TEXT[status]}</span>
          {canEdit && (<>
            <button type="button" className="icon-btn" aria-label="Deshacer" disabled={!history.canUndo} onClick={history.undo}><Icon name="undo" /></button>
            <button type="button" className="icon-btn" aria-label="Rehacer" disabled={!history.canRedo} onClick={history.redo}><Icon name="redo" /></button>
          </>)}
          <button type="button" className="btn" onClick={() => { void sync(); }}><Icon name="sync" size={14} /> Actualizar</button>
          {(role === 'owner' || canEdit || role === 'commenter') && (
            <details className="activity-pop" onToggle={(event) => event.currentTarget.open && gateway && void collabApi.activity(gateway, 'document', id).then(setActivity).catch(() => setActivity([]))}>
              <summary className="btn"><Icon name="activity" size={14} /> Actividad</summary>
              <div className="popover-panel align-end">
                {activity === null ? <p className="muted small">Cargando…</p> : activity.length === 0 ? <p className="muted small">Sin actividad todavía.</p> : (
                  <ul className="activity" aria-label="Actividad del proyecto">
                    {activity.map((entry) => (<li key={entry.id}><span>{entry.actor === 'owner' ? 'Propietario' : entry.actor === 'me' ? 'Vos' : entry.actor ?? 'Alguien'} {entry.action === 'edited' ? 'editó el proyecto' : entry.action === 'commented' ? 'dejó un comentario' : entry.action}</span><time className="muted small" dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></li>))}
                  </ul>
                )}
              </div>
            </details>
          )}
        </div>
      </header>

      {status === 'revoked' && (
        <div className="share-banner danger" role="alert">
          <strong>{problem || 'Ya no tenés acceso a este proyecto.'}</strong>
          <p>Lo que escribiste sigue en este dispositivo. No se sube nada más.</p>
          <button type="button" className="btn" onClick={() => void keepMine()}>Guardar mi copia en mi biblioteca</button>
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="share-banner" role="status">
          <strong>Se combinaron tus cambios con los de otra persona.</strong>
          <p>
            {conflicts.filter((item) => item.kind === 'both-edited').length > 0
              ? `En ${conflicts.length} ${conflicts.length === 1 ? 'lugar' : 'lugares'} los dos editaron lo mismo: dejé la otra versión en su lugar y tu texto como una copia que dice «(tu versión)». Fijate cuál conservar.`
              : 'Algo que editaste fue borrado por la otra persona: lo conservé.'}
          </p>
          <button type="button" className="btn btn-ghost" onClick={() => setConflicts([])}>Entendido</button>
        </div>
      )}
      {role === 'viewer' && <p className="muted small share-note-line">Tenés acceso de lectura: podés leer y escuchar, no editar.</p>}
      {role === 'commenter' && <p className="muted small share-note-line">Podés leer, escuchar y dejar comentarios. La música no se puede cambiar.</p>}

      <div className="nb-page">
        <div className="nb-main">
          <NotebookBlocks
            notebook={role === 'owner' || canEdit ? history.value : copy.content}
            change={canEdit ? history.set : undefined}
            undo={canEdit ? history.undo : undefined}
            documentId={`shared:${id}`}
            readOnly={!canEdit}
            onAddComment={role === 'commenter' ? addRemoteComment : undefined}
          />
        </div>
      </div>
    </section>
  );
}

export type { Role };
export { CollabError };
