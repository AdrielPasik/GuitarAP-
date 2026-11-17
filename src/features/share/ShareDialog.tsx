import { useCallback, useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast-context';
import { useAccount } from '@/features/account/account-context';
import {
  collabApi, CollabError, guestUrl, inviteUrl, knownUrl, rememberUrl,
  type ActivityEntry, type InviteInfo, type LinkInfo, type MemberInfo, type Overview, type ResourceKind, type Role,
} from '@/features/share/collab-api';
import { useCollabState, useGateway } from '@/features/share/use-collab';

const ROLE_LABEL: Record<Role, string> = { editor: 'Editor', commenter: 'Comentarista', viewer: 'Lector' };
const ROLE_HINT: Record<Role, string> = {
  editor: 'Puede escribir letra y melodía, editar tablaturas, agregar bloques y comentar.',
  commenter: 'Puede leer, escuchar y dejar comentarios. No cambia la música.',
  viewer: 'Puede leer y escuchar. No escribe nada.',
};
const ACTION_LABEL: Record<string, string> = {
  edited: 'editó el proyecto',
  commented: 'dejó un comentario',
  link_created: 'creó un enlace',
  link_updated: 'cambió un enlace',
  link_revoked: 'revocó un enlace',
  invite_created: 'creó una invitación',
  invite_accepted: 'aceptó la invitación',
  role_changed: 'cambió un rol',
  access_revoked: 'revocó un acceso',
};
const EXPIRY: Array<{ value: string; label: string; days: number | null }> = [
  { value: 'never', label: 'Nunca', days: null },
  { value: '1', label: 'En 1 día', days: 1 },
  { value: '7', label: 'En 7 días', days: 7 },
  { value: '30', label: 'En 30 días', days: 30 },
];

const when = (value: string | null) => (value ? new Date(value).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const activeLink = (link: LinkInfo) => !link.revokedAt && (!link.expiresAt || new Date(link.expiresAt) > new Date());
const pendingInvite = (invite: InviteInfo) => !invite.acceptedAt && !invite.revokedAt && new Date(invite.expiresAt) > new Date();

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Share a song or a folder. Three things, clearly apart: a read-only link (optionally with a password and an expiry),
 * people who can comment or edit (invited explicitly, by account), and what is currently shared. Everything the
 * owner does here is decided by the server; this dialog never grants anything by itself.
 */
export function ShareDialog({ kind, id, title, onClose }: { kind: ResourceKind; id: string; title: string; onClose: () => void }) {
  const toast = useToast();
  const account = useAccount();
  const gateway = useGateway();
  const state = useCollabState();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [scope, setScope] = useState<Array<{ id: string; title: string }>>([]);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ label: string; url: string } | null>(null);
  const [password, setPassword] = useState('');
  const [protect, setProtect] = useState(false);
  const [expiry, setExpiry] = useState('never');
  const [allowExport, setAllowExport] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [inviteRole, setInviteRole] = useState<Role>('editor');
  const [confirmAll, setConfirmAll] = useState(false);
  const signedIn = Boolean(account.session);

  const load = useCallback(async () => {
    if (!gateway || !gateway.accessToken) return;
    try {
      const [next, preview] = await Promise.all([collabApi.overview(gateway, kind, id), collabApi.previewScope(gateway, kind, id)]);
      setOverview(next);
      setScope(preview.documents);
      setError('');
    } catch (failure) {
      if (failure instanceof CollabError && failure.failure === 'forbidden') {
        setError('Este material todavía no está en tu cuenta en la nube. Sincronizá tu biblioteca primero (Configuración → Sincronización) y volvé a abrir Compartir.');
      } else setError(failure instanceof Error ? failure.message : 'No se pudo cargar.');
    }
  }, [gateway, id, kind]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state === 'ready' && signedIn) void load();
  }, [state, signedIn, load]);
  // Someone may accept an invitation while this is open: keep the lists current.
  useEffect(() => {
    if (state !== 'ready' || !signedIn) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [state, signedIn, load]);

  async function act<T>(work: () => Promise<T>, done?: string) {
    setBusy(true);
    setError('');
    try {
      const result = await work();
      if (done) toast.show(done);
      await load();
      return result;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo completar.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function createLink() {
    if (!gateway) return;
    const days = EXPIRY.find((item) => item.value === expiry)?.days ?? null;
    const created = await act(
      () =>
        collabApi.createLink(gateway, kind, id, {
          password: protect ? password : undefined,
          expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : undefined,
          allowExport,
        }),
    );
    if (created) {
      const url = guestUrl(created.token);
      rememberUrl(created.id, url);
      setFresh({ label: 'Enlace de solo lectura', url });
      setPassword('');
      setProtect(false);
    }
  }
  async function createInvite() {
    if (!gateway) return;
    const created = await act(() => collabApi.createInvite(gateway, kind, id, inviteRole));
    if (created) {
      const url = inviteUrl(created.token);
      rememberUrl(created.id, url);
      setFresh({ label: `Invitación como ${ROLE_LABEL[inviteRole].toLowerCase()}`, url });
    }
  }
  async function revokeEverything() {
    if (!gateway || !overview) return;
    await act(async () => {
      for (const link of overview.links.filter(activeLink)) await collabApi.revokeLink(gateway, link.id);
      for (const invite of overview.invites.filter(pendingInvite)) await collabApi.revokeInvite(gateway, invite.id);
      for (const member of overview.members.filter((item) => !item.revokedAt)) await collabApi.revokeMember(gateway, member.id);
    }, 'Dejaste de compartir. Los enlaces e invitaciones ya no funcionan.');
    setConfirmAll(false);
    setFresh(null);
  }
  async function showActivity() {
    if (!gateway) return;
    try {
      setActivity(await collabApi.activity(gateway, kind, id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo cargar la actividad.');
    }
  }

  const links = overview?.links.filter(activeLink) ?? [];
  const members = overview?.members.filter((member) => !member.revokedAt) ?? [];
  const invites = overview?.invites.filter(pendingInvite) ?? [];
  const status = members.length ? 'Compartido con colaboradores' : links.length ? 'Compartido mediante enlace' : invites.length ? 'Invitación pendiente' : 'Privado';

  return (
    <Dialog title={`Compartir «${title || 'Sin título'}»`} size="lg" onClose={onClose}>
      <div className="share">
        {state === 'unconfigured' && <p className="share-note">Esta versión de GuitarAP no tiene la nube conectada, así que no se puede compartir.</p>}
        {state === 'checking' && <p className="share-note" role="status">Comprobando la nube…</p>}
        {state === 'offline' && <p className="share-note" role="alert">No hay conexión con la nube. Probá de nuevo cuando vuelva Internet.</p>}
        {state === 'unavailable' && (
          <div className="share-note" role="alert">
            <strong>Compartir todavía no está activado.</strong>
            <p>
              El proyecto de Supabase de esta cuenta no tiene instalada la migración <code>0007_sharing.sql</code>. Mientras tanto, tus materiales siguen siendo privados y nada se publica.
              Los pasos para activarlo están en <code>docs/sharing-activation.md</code>.
            </p>
          </div>
        )}
        {state === 'ready' && !signedIn && (
          <div className="share-note">
            <p>Para compartir necesitás iniciar sesión: los permisos están ligados a tu cuenta.</p>
            <button type="button" className="btn btn-primary" onClick={() => account.openDialog('sign-in')}>Iniciar sesión</button>
          </div>
        )}

        {state === 'ready' && signedIn && (
          <>
            <p className="share-status" data-state={status}>
              <Icon name={status === 'Privado' ? 'lock' : 'users'} size={15} />
              <strong>{status}</strong>
              <span className="muted small">{status === 'Privado' ? 'Solo vos podés verlo.' : 'Podés dejar de compartir cuando quieras.'}</span>
              <button type="button" className="btn btn-ghost share-refresh" onClick={() => void load()}><Icon name="sync" size={13} /> Actualizar</button>
            </p>
            {error && <p className="share-error" role="alert">{error}</p>}
            {account.linked === false && <p className="share-note small">Tu biblioteca todavía no está vinculada a la nube. Vinculala en Configuración → Sincronización para poder compartir.</p>}

            {kind === 'node' && (
              <details className="share-scope" open>
                <summary>Esto compartirá {scope.length} {scope.length === 1 ? 'material' : 'materiales'} de esta carpeta</summary>
                <ul>{scope.map((item) => (<li key={item.id}>{item.title || 'Sin título'}</li>))}</ul>
                <p className="muted small">Se incluye todo lo que esté dentro (también subcarpetas), ahora y mientras siga dentro. Si movés un material afuera, deja de compartirse. Nada de tu otra biblioteca queda accesible.</p>
              </details>
            )}

            {fresh && (
              <div className="share-fresh" role="status">
                <strong>{fresh.label}</strong>
                <div className="share-copy">
                  <input readOnly aria-label="Enlace para copiar" value={fresh.url} onFocus={(event) => event.currentTarget.select()} />
                  <button type="button" className="btn btn-primary" onClick={async () => toast.show((await copyText(fresh.url)) ? 'Enlace copiado.' : 'No se pudo copiar: seleccionalo y copialo a mano.')}>Copiar enlace</button>
                </div>
                <p className="muted small">Por seguridad el enlace se muestra completo solo ahora. En este dispositivo podrás volver a copiarlo desde la lista.</p>
              </div>
            )}

            <section className="share-section" aria-labelledby="share-link-title">
              <h3 id="share-link-title"><Icon name="link2" size={15} /> Enlace de solo lectura</h3>
              <p className="muted small">Quien tenga el enlace puede leer, escuchar y ver este material, sin cuenta y sin poder editar.</p>
              {links.map((link) => {
                const url = knownUrl(link.id);
                return (
                  <div key={link.id} className="share-row">
                    <span>
                      <strong>Enlace del {when(link.createdAt)}</strong>
                      <span className="muted small block">
                        {link.hasPassword ? 'Con contraseña' : 'Sin contraseña'} · {link.expiresAt ? `vence el ${when(link.expiresAt)}` : 'no vence'} · se abrió {link.openCount} {link.openCount === 1 ? 'vez' : 'veces'}
                        {link.locked ? ' · bloqueado por intentos fallidos' : ''}
                      </span>
                    </span>
                    {url && <button type="button" className="btn btn-ghost" onClick={async () => toast.show((await copyText(url)) ? 'Enlace copiado.' : 'No se pudo copiar.')}>Copiar enlace</button>}
                    <button type="button" className="btn btn-danger" disabled={busy} onClick={() => gateway && void act(() => collabApi.revokeLink(gateway, link.id), 'Enlace revocado: ya no funciona.')}>Revocar</button>
                  </div>
                );
              })}
              <div className="share-form">
                <label className="check">
                  <input type="checkbox" checked={protect} onChange={(event) => setProtect(event.target.checked)} /> Proteger con contraseña
                </label>
                {protect && (
                  <label className="field">
                    <span>Contraseña del enlace (mínimo 8 caracteres)</span>
                    <input type="password" autoComplete="new-password" aria-label="Contraseña del enlace" value={password} onChange={(event) => setPassword(event.target.value)} />
                  </label>
                )}
                <button type="button" className="btn btn-link" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>Más opciones {advanced ? '▴' : '▾'}</button>
                {advanced && (
                  <div className="share-advanced">
                    <label className="field inline">
                      <span>Vence</span>
                      <select aria-label="Vencimiento del enlace" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                        {EXPIRY.map((item) => (<option key={item.value} value={item.value}>{item.label}</option>))}
                      </select>
                    </label>
                    <label className="check">
                      <input type="checkbox" checked={allowExport} onChange={(event) => setAllowExport(event.target.checked)} /> Permitir exportar desde la pantalla
                      <small className="muted block">Solo cambia los botones de la interfaz: no impide capturas ni copias externas.</small>
                    </label>
                  </div>
                )}
                <button type="button" className="btn btn-primary" disabled={busy || (protect && password.length < 8)} onClick={() => void createLink()}>Crear enlace de lectura</button>
              </div>
            </section>

            <section className="share-section" aria-labelledby="share-people-title">
              <h3 id="share-people-title"><Icon name="users" size={15} /> Colaboradores</h3>
              <p className="muted small">Personas con cuenta en GuitarAP. Vos decidís qué pueden hacer; los permisos los aplica el servidor.</p>
              {members.length === 0 && invites.length === 0 && <p className="muted small">Todavía no invitaste a nadie.</p>}
              {members.map((member: MemberInfo) => (
                <div key={member.id} className="share-row">
                  <span><strong>{member.label}</strong><span className="muted small block">Desde el {when(member.createdAt)}</span></span>
                  <select
                    aria-label={`Rol de ${member.label}`}
                    value={member.role}
                    disabled={busy}
                    onChange={(event) => gateway && void act(() => collabApi.setRole(gateway, member.id, event.target.value as Role), 'Rol actualizado.')}
                  >
                    {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (<option key={role} value={role}>{ROLE_LABEL[role]}</option>))}
                  </select>
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={() => gateway && void act(() => collabApi.revokeMember(gateway, member.id), `${member.label} ya no tiene acceso.`)}>Quitar acceso</button>
                </div>
              ))}
              {invites.map((invite) => {
                const url = knownUrl(invite.id);
                return (
                  <div key={invite.id} className="share-row">
                    <span><strong>Invitación pendiente · {ROLE_LABEL[invite.role]}</strong><span className="muted small block">Vence el {when(invite.expiresAt)}</span></span>
                    {url && <button type="button" className="btn btn-ghost" onClick={async () => toast.show((await copyText(url)) ? 'Invitación copiada.' : 'No se pudo copiar.')}>Copiar</button>}
                    <button type="button" className="btn btn-danger" disabled={busy} onClick={() => gateway && void act(() => collabApi.revokeInvite(gateway, invite.id), 'Invitación revocada.')}>Revocar</button>
                  </div>
                );
              })}
              <div className="share-form">
                <label className="field inline">
                  <span>Invitar como</span>
                  <select aria-label="Rol de la invitación" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Role)}>
                    {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (<option key={role} value={role}>{ROLE_LABEL[role]}</option>))}
                  </select>
                </label>
                <p className="muted small">{ROLE_HINT[inviteRole]}</p>
                <button type="button" className="btn" disabled={busy} onClick={() => void createInvite()}>Crear invitación</button>
                <p className="muted small">La persona abre el enlace, inicia sesión con su cuenta y acepta. No hace falta su correo.</p>
              </div>
            </section>

            <details className="share-section" onToggle={(event) => event.currentTarget.open && void showActivity()}>
              <summary><Icon name="activity" size={15} /> Actividad</summary>
              {activity === null ? <p className="muted small">Cargando…</p> : activity.length === 0 ? <p className="muted small">Todavía no pasó nada.</p> : (
                <ul className="activity" aria-label="Actividad del proyecto">
                  {activity.map((entry) => (
                    <li key={entry.id}>
                      <span>{entry.actor === 'owner' ? 'Propietario' : entry.actor === 'me' ? 'Vos' : entry.actor ?? 'Alguien'} {ACTION_LABEL[entry.action] ?? entry.action}</span>
                      <time className="muted small" dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                    </li>
                  ))}
                </ul>
              )}
            </details>

            {(links.length > 0 || members.length > 0 || invites.length > 0) && (
              <section className="share-danger" aria-label="Dejar de compartir">
                {!confirmAll ? (
                  <button type="button" className="btn btn-danger" onClick={() => setConfirmAll(true)}>Dejar de compartir todo…</button>
                ) : (
                  <div className="share-confirm" role="alertdialog" aria-label="Confirmar">
                    <p>Se revocan todos los enlaces, invitaciones y accesos. Quien ya descargó o exportó contenido lo conserva: la revocación controla el acceso futuro, no borra copias.</p>
                    <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void revokeEverything()}>Sí, dejar de compartir</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmAll(false)}>Cancelar</button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
