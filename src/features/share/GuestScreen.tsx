import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { StudioScene } from '@/components/art/Art';
import { LogoMark } from '@/components/brand/Logo';
import { Icon } from '@/components/ui/Icon';
import type { NotebookContent } from '@/core/model';
import { everything } from '@/features/export/export-plan';
import { toNotebook } from '@/core/notebook';
import { NotebookBlocks } from '@/features/notebook/NotebookBlocks';
import { collabApi, CollabError, gatewayFor } from '@/features/share/collab-api';
import { useParams } from 'react-router-dom';

const ExportDialog = lazy(() => import('@/features/export/ExportDialog').then((module) => ({ default: module.ExportDialog })));

type Doc = { id: string; title: string; type: string; content: unknown };
type View =
  | { step: 'loading' }
  | { step: 'problem'; reason: 'invalid' | 'revoked' | 'expired' | 'gone' | 'unavailable' | 'offline' }
  | { step: 'password'; title: string; error?: string; locked?: number }
  | { step: 'ready'; title: string; kind: 'document' | 'node'; allowExport: boolean; documents: Doc[] };

const PROBLEMS: Record<Extract<View, { step: 'problem' }>['reason'], { title: string; text: string }> = {
  invalid: { title: 'Este enlace no funciona', text: 'No existe o quedó mal copiado. Pedile a quien te lo mandó que lo vuelva a compartir.' },
  revoked: { title: 'Este enlace fue desactivado', text: 'La persona que lo compartió dejó de compartir este proyecto. Si lo necesitás, pedile un enlace nuevo.' },
  expired: { title: 'Este enlace venció', text: 'Los enlaces pueden tener fecha de vencimiento. Pedile a quien te lo mandó que genere uno nuevo.' },
  gone: { title: 'Este proyecto ya no está disponible', text: 'Fue movido o eliminado por su propietario.' },
  unavailable: { title: 'No se puede abrir desde acá', text: 'Esta copia de GuitarAP no tiene el uso compartido activado.' },
  offline: { title: 'Sin conexión', text: 'Revisá tu conexión a Internet y volvé a abrir el enlace.' },
};

const sessionKey = (token: string) => `guitarap.guest.${token.slice(0, 12)}`;

/**
 * What a person sees when they open a link: a quiet, readable presentation of the song with a Play button, and
 * nothing that would let them change it. They need no account. Content is requested only after the server accepted
 * the link (and the password, when there is one): before that this page holds nothing but the title.
 */
export function GuestScreen() {
  const { token = '' } = useParams();
  const gateway = useMemo(() => gatewayFor(null), []);
  const [view, setView] = useState<View>({ step: 'loading' });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<Doc | null>(null);

  useEffect(() => {
    document.title = 'GuitarAP · Compartido';
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    const referrer = document.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    document.head.append(robots, referrer);
    return () => {
      robots.remove();
      referrer.remove();
    };
  }, []);

  async function open(session: string | null) {
    if (!gateway) return setView({ step: 'problem', reason: 'unavailable' });
    try {
      const read = await collabApi.read(gateway, token, session);
      if (read.ok) {
        setView({ step: 'ready', title: read.title ?? 'Canción', kind: read.kind ?? 'document', allowExport: Boolean(read.allowExport), documents: read.documents ?? [] });
      } else if (read.reason === 'password_required') {
        const info = await collabApi.linkInfo(gateway, token);
        setView({ step: 'password', title: info.title ?? 'Proyecto protegido' });
      } else setView({ step: 'problem', reason: 'invalid' });
    } catch (error) {
      setView({ step: 'problem', reason: error instanceof CollabError && error.failure === 'offline' ? 'offline' : 'unavailable' });
    }
  }

  useEffect(() => {
    let live = true;
    void (async () => {
      if (!gateway) return live && setView({ step: 'problem', reason: 'unavailable' });
      try {
        const info = await collabApi.linkInfo(gateway, token);
        if (!live) return;
        if (!info.valid) return setView({ step: 'problem', reason: info.reason ?? 'invalid' });
        if (info.requiresPassword) {
          const saved = window.sessionStorage.getItem(sessionKey(token));
          if (saved) return void open(saved);
          return setView({ step: 'password', title: info.title ?? 'Proyecto protegido', locked: info.locked ? 1 : undefined });
        }
        void open(null);
      } catch (error) {
        if (live) setView({ step: 'problem', reason: error instanceof CollabError && error.failure === 'offline' ? 'offline' : 'unavailable' });
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, gateway]);

  async function unlock() {
    if (!gateway) return;
    setBusy(true);
    try {
      const result = await collabApi.unlock(gateway, token, password);
      if (result.ok) {
        if (result.session) window.sessionStorage.setItem(sessionKey(token), result.session);
        setPassword('');
        await open(result.session ?? null);
      } else if (result.reason === 'locked') {
        setView((current) => ({ ...(current as Extract<View, { step: 'password' }>), error: `Demasiados intentos. Probá de nuevo en ${Math.max(1, Math.ceil((result.retryAfterSeconds ?? 900) / 60))} minutos.`, locked: result.retryAfterSeconds }));
      } else if (result.reason === 'invalid') setView({ step: 'problem', reason: 'revoked' });
      else setView((current) => ({ ...(current as Extract<View, { step: 'password' }>), error: 'La contraseña no es correcta.' }));
    } catch {
      setView((current) => ({ ...(current as Extract<View, { step: 'password' }>), error: 'No se pudo comprobar la contraseña. Probá de nuevo.' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="guest">
      <header className="guest-bar">
        <span className="brand">
          <span className="brand-mark"><LogoMark size={30} /></span>
          <span className="brand-name">Guitar<span className="ap">AP</span></span>
        </span>
        <span className="muted small">Compartido con vos · solo lectura</span>
      </header>
      <main className="guest-main" id="contenido" tabIndex={-1}>
        {view.step === 'loading' && <p className="route-fallback" role="status">Abriendo…</p>}

        {view.step === 'problem' && (
          <section className="guest-card scenic" aria-labelledby="guest-problem">
            <StudioScene variant="compact" />
            <h1 id="guest-problem">{PROBLEMS[view.reason].title}</h1>
            <p>{PROBLEMS[view.reason].text}</p>
          </section>
        )}

        {view.step === 'password' && (
          <section className="guest-card scenic" aria-labelledby="guest-locked">
            <StudioScene variant="compact" />
            <p className="hero-kicker"><Icon name="lock" size={13} /> Proyecto protegido</p>
            <h1 id="guest-locked">{view.title}</h1>
            <p>Este proyecto está protegido con una contraseña. Pedísela a quien te lo compartió.</p>
            <form
              className="guest-form"
              onSubmit={(event) => {
                event.preventDefault();
                void unlock();
              }}
            >
              <label className="field">
                <span>Contraseña</span>
                <input type="password" autoFocus autoComplete="off" aria-label="Contraseña" value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={Boolean(view.error)} />
              </label>
              {view.error && <p className="share-error" role="alert">{view.error}</p>}
              <button type="submit" className="btn btn-primary" disabled={busy || !password}>Entrar</button>
            </form>
          </section>
        )}

        {view.step === 'ready' && (
          <article className="guest-song">
            <section className="guest-hero">
              <StudioScene variant="compact" />
              <p className="hero-kicker">Compartido con vos</p>
              <h1 className="hero-title">{view.title}</h1>
              <p className="hero-sub">{view.kind === 'node' ? `${view.documents.length} materiales` : 'Podés leer, escuchar y mirar. No se puede editar desde acá.'}</p>
            </section>
            {view.documents.map((doc) => {
              const notebook = toNotebook({ id: doc.id, type: doc.type as 'tablature' | 'fretboard', content: doc.content as NotebookContent });
              return (
                <section key={doc.id} className="guest-doc" aria-label={doc.title}>
                  {view.kind === 'node' && <h2 className="guest-doc-title">{doc.title}</h2>}
                  <div className="practice-stage">
                    <NotebookBlocks notebook={notebook} readOnly />
                  </div>
                  {view.allowExport && (
                    <button type="button" className="btn btn-ghost" onClick={() => setExporting(doc)}><Icon name="export" size={14} /> Exportar</button>
                  )}
                </section>
              );
            })}
          </article>
        )}
      </main>
      <footer className="guest-foot muted small">Hecho con GuitarAP · tu estudio para componer y estudiar</footer>
      {exporting && (
        <Suspense fallback={null}>
          <ExportDialog
            title={exporting.title}
            notebook={toNotebook({ id: exporting.id, type: exporting.type as 'tablature' | 'fretboard', content: exporting.content as NotebookContent })}
            initial={everything(toNotebook({ id: exporting.id, type: exporting.type as 'tablature' | 'fretboard', content: exporting.content as NotebookContent }))}
            onClose={() => setExporting(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
