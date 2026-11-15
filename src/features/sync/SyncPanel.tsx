import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '@/data/database';
import { activateOwner, deactivateOwner } from '@/data/library-scope';
import { libraryRepository } from '@/data/library-repository';
import { SyncEngine, type SyncReport } from '@/features/sync/engine';
import { configuredSupabase, restoreSession, signIn, signOut, type SupabaseSession } from '@/features/sync/supabase-auth';
import { SupabaseTransport } from '@/features/sync/transport';
import { describeBackup, downloadBackup, type BackupSummary } from '@/features/backup/backup-download';

const backupKey = (ownerId: string) => `sync-backup-confirmed:${ownerId}`;

export function SyncPanel() {
  const config = useMemo(() => configuredSupabase(), []); const [session, setSession] = useState<SupabaseSession | null>(null); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [backupReady, setBackupReady] = useState(false); const [busy, setBusy] = useState(false); const [backupBusy, setBackupBusy] = useState(false); const [preparedBackup, setPreparedBackup] = useState<BackupSummary | null>(null); const [backupConfirmed, setBackupConfirmed] = useState(false); const [message, setMessage] = useState(''); const [errorMessage, setErrorMessage] = useState(''); const [report, setReport] = useState<SyncReport | null>(null);
  useEffect(() => { if (!config) return; void restoreSession(config).then(async (current) => { setSession(current); if (current) setBackupReady(Boolean((await db.settings.get(backupKey(current.user.id)))?.value)); }); }, [config]);
  const sync = useCallback(async () => { if (!config || !session || !backupReady) return; setBusy(true); try { const current = await restoreSession(config); if (!current) throw new Error('La sesión expiró. Volvé a iniciar sesión.'); setSession(current); const next = await new SyncEngine(new SupabaseTransport(config.url, config.anonKey, current.accessToken)).sync(current.user.id); setReport(next); setMessage(next.offline ? 'Sin conexión: tus cambios permanecen locales y se reintentará al recuperar red.' : `Sincronización completada: ${next.pushed} subidos, ${next.pulled} descargados, ${next.conflicts} conflictos.`); } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo sincronizar.'); } finally { setBusy(false); } }, [backupReady, config, session]);
  useEffect(() => { const retry = () => { void sync(); }; window.addEventListener('online', retry); return () => window.removeEventListener('online', retry); }, [sync]);
  async function prepareBackup() {
    setBackupBusy(true); setErrorMessage(''); setMessage(''); setPreparedBackup(null); setBackupConfirmed(false);
    try {
      const raw = await libraryRepository.exportBackup();
      const summary = downloadBackup(raw);
      setPreparedBackup(summary);
      setMessage(`Descarga iniciada: ${describeBackup(summary)}. Comprobá que Chrome guardó el archivo antes de continuar.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo preparar el backup. Tus datos locales no fueron modificados.');
    } finally { setBackupBusy(false); }
  }
  async function confirmBackupAndLink() {
    if (!session || !preparedBackup || !backupConfirmed) return;
    setBackupBusy(true); setErrorMessage('');
    try {
      await activateOwner(session.user.id);
      await db.settings.put({ key: backupKey(session.user.id), value: true, updatedAt: Date.now() });
      setBackupReady(true); setMessage('Biblioteca vinculada. La sincronización quedó habilitada; todavía no se ejecutó ninguna subida.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo vincular la biblioteca. El backup y los documentos locales permanecen intactos.');
    } finally { setBackupBusy(false); }
  }
  if (!config) return <section className="rounded-xl border border-dashed border-stone-300 p-4 text-sm text-stone-600 dark:border-white/15 dark:text-stone-300"><h2 className="font-semibold text-stone-800 dark:text-white">Cuenta y sincronización</h2><p className="mt-1">Supabase todavía no está configurado. Agregá únicamente <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> en tu entorno de build; nunca una clave <code>service_role</code>.</p></section>;
  if (!session) return <section className="rounded-xl border border-stone-200 bg-white/65 p-4 dark:border-white/10 dark:bg-white/5"><h2 className="font-semibold">Cuenta privada</h2><p className="mt-1 text-sm text-stone-500">El registro está cerrado: iniciá sesión con una cuenta creada previamente por el administrador de Supabase.</p><form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setBusy(true); void signIn(config, email, password).then(async (next) => { setSession(next); setBackupReady(Boolean((await db.settings.get(backupKey(next.user.id)))?.value)); setMessage('Sesión iniciada. Exportá un backup antes del primer sincronizado.'); }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesión.')).finally(() => setBusy(false)); }}><input aria-label="Email de cuenta" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@ejemplo.com" className="control min-w-52" /><input aria-label="Contraseña de cuenta" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Contraseña" className="control min-w-44" /><button className="control-primary" disabled={busy}>Iniciar sesión</button></form>{message && <p role="status" className="mt-3 text-sm text-amber-700">{message}</p>}</section>;
  return <section className="rounded-xl border border-stone-200 bg-white/65 p-4 dark:border-white/10 dark:bg-white/5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Cuenta y sincronización</h2><p className="mt-1 text-sm text-stone-500">{session.user.email ?? session.user.id} · Los datos siguen disponibles en este dispositivo sin conexión.</p></div><button className="control" onClick={() => { signOut(); void deactivateOwner(); setSession(null); setReport(null); }}>Cerrar sesión</button></div>{!backupReady ? <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><strong>Backup requerido antes del primer sincronizado.</strong><p className="mt-1">Primero descargá y revisá la copia. La biblioteca se vincula solamente después de tu confirmación explícita.</p><button className="control mt-3" disabled={backupBusy} onClick={() => void prepareBackup()}>{backupBusy && !preparedBackup ? 'Preparando backup…' : 'Exportar backup'}</button>{preparedBackup ? <div className="mt-3 border-t border-amber-300 pt-3"><p><strong>Contenido verificado:</strong> {describeBackup(preparedBackup)}.</p><label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={backupConfirmed} onChange={(event) => setBackupConfirmed(event.target.checked)} /><span>Confirmo que Chrome guardó el archivo JSON y que puedo encontrarlo en Descargas.</span></label><button className="control-primary mt-3" disabled={!backupConfirmed || backupBusy} onClick={() => void confirmBackupAndLink()}>{backupBusy ? 'Vinculando…' : 'Confirmar backup y habilitar'}</button></div> : null}</div> : <div className="mt-4 flex flex-wrap items-center gap-2"><button className="control-primary" disabled={busy} onClick={() => void sync()}>{busy ? 'Sincronizando…' : 'Sincronizar ahora'}</button><span className="text-xs text-stone-500">Los reintentos se ejecutan al recuperar conexión.</span></div>}{report?.conflicts ? <p className="mt-3 text-sm text-amber-700">Hay {report.conflicts} conflicto(s) conservados localmente para resolución manual.</p> : null}{errorMessage && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{errorMessage}</p>}{message && <p role="status" className="mt-3 text-sm text-amber-700 dark:text-amber-300">{message}</p>}</section>;
}
