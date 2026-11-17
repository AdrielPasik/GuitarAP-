import { useContext, useRef, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { APP_VERSION } from '@/core/app-info';
import { usePref } from '@/core/prefs';
import { StudioScene } from '@/components/art/Art';
import { transport } from '@/audio/engine';
import { progressionToSequence } from '@/audio/plan';
import { useSoundPrefs } from '@/audio/useBlockPlayer';
import { setMasterVolume } from '@/audio/webaudio-backend';
import { useNoteStyle } from '@/features/melody/note-style';
import { useFxPrefs } from '@/features/theme/fx-prefs';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { db } from '@/data/database';
import { libraryRepository } from '@/data/library-repository';
import { belongsToOwner, libraryScope } from '@/data/library-scope';
import { describeLastSync } from '@/features/account/account-status';
import { StatusChip } from '@/features/account/AccountMenu';
import { useAccount } from '@/features/account/account-context';
import { LinkWizard } from '@/features/account/LinkWizard';
import { describeBackup, downloadBackup, inspectBackup, type BackupSummary } from '@/features/backup/backup-download';
import { ThemeContext } from '@/features/theme/theme-context';

const sections = [
  { id: 'cuenta', label: 'Cuenta', icon: 'user' as const },
  { id: 'sincronizacion', label: 'Sincronización', icon: 'sync' as const },
  { id: 'apariencia', label: 'Apariencia', icon: 'sun' as const },
  { id: 'sonido', label: 'Sonido', icon: 'play' as const },
  { id: 'musica', label: 'Preferencias musicales', icon: 'melody' as const },
  { id: 'copias', label: 'Copias de seguridad', icon: 'export' as const },
  { id: 'recuperacion', label: 'Historial y recuperación', icon: 'history' as const },
  { id: 'acerca', label: 'Acerca de', icon: 'pick' as const },
];

function AccountSection() {
  const account = useAccount();
  return (
    <>
      <h2>Cuenta</h2>
      {account.session ? (
        <div className="stack">
          <p>
            Sesión iniciada como <strong>{account.email}</strong>.
          </p>
          <p className="muted">Cerrar sesión detiene la sincronización. Tus materiales siguen en este dispositivo.</p>
          <div>
            <button type="button" className="btn" onClick={account.signOut}>
              Cerrar sesión
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <p>
            No iniciaste sesión. Todo lo que escribís se guarda <strong>solo en este dispositivo</strong>.
          </p>
          <p className="muted">Con una cuenta podés tener los mismos materiales en tus otras computadoras.</p>
          <div>
            <button type="button" className="btn btn-primary" onClick={() => account.openDialog('sign-in')}>
              <Icon name="signin" size={15} /> Iniciar sesión
            </button>
          </div>
          {!account.configured && (
            <p className="notice warn">
              <Icon name="cloud-off" size={16} />
              <span>Esta versión no tiene la nube conectada, así que por ahora iniciar sesión no está disponible.</span>
            </p>
          )}
        </div>
      )}
    </>
  );
}

function SyncSection() {
  const account = useAccount();
  return (
    <>
      <h2>Sincronización</h2>
      <p className="status-hero">
        <StatusChip />
      </p>
      <p className="muted">{account.status.detail}</p>
      {!account.session && (
        <button type="button" className="btn btn-primary" onClick={() => account.openDialog('sign-in')}>
          Iniciar sesión
        </button>
      )}
      {account.session && !account.linked && (
        <>
          <h3>Antes de sincronizar</h3>
          <LinkWizard />
        </>
      )}
      {account.session && account.linked && (
        <div className="stack">
          <dl className="facts">
            <div>
              <dt>Última sincronización</dt>
              <dd>{describeLastSync(account.lastSyncAt)}</dd>
            </div>
            <div>
              <dt>Cuenta</dt>
              <dd>{account.email}</dd>
            </div>
          </dl>
          {account.message && (
            <p role="status" className="notice warn">
              <Icon name="alert" size={16} />
              <span>{account.message}</span>
            </p>
          )}
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={account.status.kind === 'syncing'} onClick={() => void account.syncNow()}>
              Sincronizar ahora
            </button>
            <label className="check">
              <input type="checkbox" checked={account.autoSync} onChange={(event) => account.setAutoSync(event.target.checked)} />
              <span>Sincronizar automáticamente</span>
            </label>
          </div>
        </div>
      )}
    </>
  );
}

function BackupSection() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<{ raw: string; summary: BackupSummary; name: string } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [understood, setUnderstood] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  async function exportCopy() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const summary = downloadBackup(await libraryRepository.exportBackup());
      setMessage(`Se descargó una copia con ${describeBackup(summary)}.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No se pudo preparar la copia. Tus datos no se modificaron.');
    } finally {
      setBusy(false);
    }
  }
  async function readFile(selected: File) {
    setError('');
    setMessage('');
    try {
      const raw = await selected.text();
      setPick({ raw, summary: inspectBackup(raw), name: selected.name });
      setMode('merge');
      setUnderstood(false);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No pudimos leer ese archivo como una copia de GuitarAP.');
    }
  }
  async function runImport() {
    if (!pick) return;
    try {
      await libraryRepository.importBackup(pick.raw, mode);
      setMessage(mode === 'merge' ? 'La copia se combinó con tu biblioteca.' : 'Tu biblioteca se reemplazó por la copia.');
      setPick(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No se pudo importar la copia. Tu biblioteca quedó como estaba.');
      setPick(null);
    }
  }

  return (
    <>
      <h2>Copias de seguridad</h2>
      <p className="muted">
        Un archivo JSON con tus carpetas, materiales e historial. Guardalo en un lugar que no sea este navegador.
      </p>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void exportCopy()}>
          {busy ? 'Preparando…' : 'Descargar copia de seguridad'}
        </button>
        <button type="button" className="btn" onClick={() => file.current?.click()}>
          Importar una copia…
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Archivo de copia de seguridad"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void readFile(selected);
            event.currentTarget.value = '';
          }}
        />
      </div>
      {error && (
        <p role="alert" className="notice danger">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </p>
      )}
      {message && (
        <p role="status" className="notice ok">
          <Icon name="check" size={16} />
          <span>{message}</span>
        </p>
      )}
      {pick && (
        <Dialog title="Importar copia de seguridad" onClose={() => setPick(null)}>
          <div className="stack">
            <p>
              <strong>{pick.name}</strong> contiene {describeBackup(pick.summary)}.
            </p>
            <fieldset className="choices">
              <legend className="sr-only">Cómo importar</legend>
              <label className="choice">
                <input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                <span>
                  <strong>Combinar con mi biblioteca</strong>
                  <small>Agrega lo que falta y actualiza lo que coincide. No borra nada. Recomendado.</small>
                </span>
              </label>
              <label className="choice">
                <input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                <span>
                  <strong>Reemplazar toda la biblioteca</strong>
                  <small>Borra lo que hay en este dispositivo y deja solo lo de la copia.</small>
                </span>
              </label>
            </fieldset>
            {mode === 'replace' && (
              <label className="check">
                <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
                <span>Entiendo que se reemplaza lo que hay ahora y ya descargué una copia por las dudas.</span>
              </label>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setPick(null)}>
                Cancelar
              </button>
              <button type="button" className={`btn ${mode === 'replace' ? 'btn-danger' : 'btn-primary'}`} disabled={mode === 'replace' && !understood} onClick={() => void runImport()}>
                {mode === 'merge' ? 'Combinar' : 'Reemplazar'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

function RecoverySection() {
  const [selected, setSelected] = useState('');
  const data = useLiveQuery(async () => {
    const scope = await libraryScope();
    const [documents, nodes, versions] = await Promise.all([
      db.documents.toArray(),
      db.nodes.toArray(),
      selected ? db.versions.where('documentId').equals(selected).toArray() : Promise.resolve([]),
    ]);
    return {
      active: documents.filter((item) => belongsToOwner(item, scope) && !item.deletedAt),
      trashedDocuments: documents.filter((item) => belongsToOwner(item, scope) && item.deletedAt),
      trashedNodes: nodes.filter((item) => belongsToOwner(item, scope) && item.deletedAt),
      versions: versions.filter((item) => belongsToOwner(item, scope)).sort((a, b) => b.createdAt - a.createdAt),
    };
  }, [selected]) ?? { active: [], trashedDocuments: [], trashedNodes: [], versions: [] };
  const trashed = data.trashedDocuments.length + data.trashedNodes.length;
  return (
    <>
      <h2>Recuperación</h2>
      <h3>Papelera</h3>
      {trashed ? (
        <ul className="rows">
          {data.trashedDocuments.map((item) => (
            <li key={item.id}>
              <span>{item.title || 'Sin título'}</span>
              <button type="button" className="btn" onClick={() => void libraryRepository.restoreDocument(item.id)}>
                Restaurar
              </button>
            </li>
          ))}
          {data.trashedNodes.map((item) => (
            <li key={item.id}>
              <span>
                <Icon name={item.kind === 'song' ? 'song' : 'folder'} size={14} /> {item.name}
              </span>
              <button type="button" className="btn" onClick={() => void libraryRepository.restoreNode(item.id)}>
                Restaurar
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">La papelera está vacía.</p>
      )}
      <h3>Versiones anteriores</h3>
      <label className="field">
        <span>Material</span>
        <select aria-label="Material con historial" value={selected} onChange={(event) => setSelected(event.target.value)}>
          <option value="">Elegí un material…</option>
          {data.active.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title || 'Sin título'}
            </option>
          ))}
        </select>
      </label>
      {selected &&
        (data.versions.length ? (
          <ul className="rows">
            {data.versions.map((version) => (
              <li key={version.id}>
                <span>
                  {new Date(version.createdAt).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}
                  <small className="muted"> · {version.title || 'Sin título'}</small>
                </span>
                <button type="button" className="btn" onClick={() => void libraryRepository.restoreVersion(selected, version.id)}>
                  Restaurar
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Todavía no hay versiones anteriores de este material.</p>
        ))}
      {selected && <p className="muted small">Restaurar guarda antes el estado actual como una versión más.</p>}
    </>
  );
}

function AppearanceSection() {
  const theme = useContext(ThemeContext);
  const fx = useFxPrefs();
  const [, setBanner] = usePref('local-banner-hidden', false);
  return (
    <>
      <h2>Apariencia</h2>
      <div className="stack">
        <div className="field">
          <span>Tema</span>
          <Segmented<'light' | 'dark'>
            label="Tema"
            value={theme?.theme ?? 'light'}
            onChange={(value) => theme && value !== theme.theme && theme.toggleTheme()}
            options={[
              { value: 'light', label: 'Claro' },
              { value: 'dark', label: 'Oscuro' },
            ]}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={fx.decor} onChange={(event) => fx.setDecor(event.target.checked)} />
          <span>
            Ilustraciones decorativas (guitarras, notas, cuerdas)
            <small className="muted block">Solo aparecen en la Biblioteca y en los estados vacíos. Nunca detrás de la música que escribís.</small>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={fx.motion} disabled={!fx.decor} onChange={(event) => fx.setMotion(event.target.checked)} />
          <span>
            Movimiento suave en las ilustraciones
            <small className="muted block">Se detiene solo cuando la pestaña no está visible o si tu sistema pide reducir el movimiento.</small>
          </span>
        </label>
        <div>
          <button type="button" className="btn btn-ghost" onClick={() => setBanner(false)}>
            Volver a mostrar el aviso «solo en este dispositivo»
          </button>
        </div>
      </div>
    </>
  );
}

function SoundSection() {
  const sound = useSoundPrefs();
  return (
    <>
      <h2>Sonido</h2>
      <p className="muted">El sonido se genera en tu navegador: no se descarga ni se envía nada, y funciona sin conexión. Son sintetizadores simples: sirven para escuchar tus ideas, no imitan un piano ni una guitarra reales.</p>
      <div className="stack">
        <div className="field">
          <span>Instrumento predeterminado</span>
          <Segmented<'piano' | 'guitar'>
            label="Instrumento predeterminado"
            value={sound.instrument}
            onChange={sound.setInstrument}
            options={[
              { value: 'piano', label: 'Piano sintetizado' },
              { value: 'guitar', label: 'Guitarra (cuerda pulsada)' },
            ]}
          />
        </div>
        <label className="field">
          <span>Volumen inicial: {Math.round(sound.volume * 100)}%</span>
          <input
            type="range"
            aria-label="Volumen de la reproducción"
            min="0.1"
            max="1"
            step="0.05"
            value={sound.volume}
            onChange={(event) => {
              sound.setVolume(Number(event.target.value));
              setMasterVolume(Number(event.target.value));
            }}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={sound.preview} onChange={(event) => sound.setPreview(event.target.checked)} />
          <span>Escuchar cada nota o acorde al elegirlo<small className="muted block">Apagado por defecto: nada suena si no lo pedís.</small></span>
        </label>
        <label className="check">
          <input type="checkbox" checked={sound.click} onChange={(event) => sound.setClick(event.target.checked)} />
          <span>Clic de metrónomo al reproducir</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={sound.loop} onChange={(event) => sound.setLoop(event.target.checked)} />
          <span>Repetir al llegar al final</span>
        </label>
        <div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setMasterVolume(sound.volume);
              void transport.play({ owner: 'settings-test', sequence: progressionToSequence(['C', 'F', 'G', 'C'], 1.5), bpm: 100, instrument: sound.instrument });
            }}
          >
            <Icon name="play" size={14} /> Probar el sonido
          </button>
        </div>
      </div>
    </>
  );
}

function MusicSection() {
  const [advance, setAdvance] = usePref('tab-auto-advance', true);
  const [style, setStyle] = useNoteStyle();
  const [octave, setOctave] = usePref<number>('default-octave', 4);
  const [bpm, setBpm] = usePref<number>('default-bpm', 96);
  return (
    <>
      <h2>Preferencias musicales</h2>
      <p className="muted">Son preferencias de este dispositivo: cambian cómo se muestran y cómo se empieza a escribir, nunca las notas que ya guardaste.</p>
      <div className="stack">
        <div className="field">
          <span>Nombres de las notas en las melodías</span>
          <Segmented<'latin' | 'english'>
            label="Nombres de las notas"
            value={style}
            onChange={setStyle}
            options={[
              { value: 'latin', label: 'Do Re Mi' },
              { value: 'english', label: 'C D E' },
            ]}
          />
        </div>
        <label className="field">
          <span>Octava con la que empieza una melodía nueva</span>
          <select aria-label="Octava predeterminada" value={octave} onChange={(event) => setOctave(Number(event.target.value))}>
            {[2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>Octava {value}{value === 4 ? ' (la de Do central)' : ''}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tempo predeterminado del metrónomo (BPM)</span>
          <input type="number" aria-label="Tempo predeterminado" min={30} max={280} value={bpm} onChange={(event) => setBpm(Math.max(30, Math.min(280, Number(event.target.value) || 96)))} />
        </label>
        <label className="check">
          <input type="checkbox" checked={advance} onChange={(event) => setAdvance(event.target.checked)} />
          <span>En la tablatura, pasar al evento siguiente al escribir una nota</span>
        </label>
      </div>
    </>
  );
}

function AboutSection() {
  return (
    <>
      <h2>Acerca de GuitarAP</h2>
      <p className="muted">Tu estudio personal para componer, estudiar y escuchar tus ideas musicales. Funciona sin conexión.</p>
      <dl className="facts">
        <div>
          <dt>Versión</dt>
          <dd>{APP_VERSION}</dd>
        </div>
        <div>
          <dt>Datos</dt>
          <dd>Guardados en este dispositivo</dd>
        </div>
      </dl>
    </>
  );
}

const views = {
  cuenta: AccountSection,
  sincronizacion: SyncSection,
  copias: BackupSection,
  recuperacion: RecoverySection,
  apariencia: AppearanceSection,
  sonido: SoundSection,
  musica: MusicSection,
  preferencias: AppearanceSection,
  acerca: AboutSection,
};

export function SettingsScreen() {
  const { section } = useParams();
  const key = (section && section in views ? section : 'cuenta') as keyof typeof views;
  const View = views[key];
  return (
    <div className="settings">
      <header className="settings-hero">
        <StudioScene variant="compact" />
        <h1 className="settings-title">Tu estudio, a tu manera</h1>
      </header>
      <nav className="settings-nav" aria-label="Secciones de configuración">
        {sections.map((item) => (
          <NavLink key={item.id} to={`/configuracion/${item.id}`} className={item.id === key ? 'active' : ''} aria-current={item.id === key ? 'page' : undefined}>
            <Icon name={item.icon} size={15} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <section className="settings-body" aria-live="polite">
        <View />
      </section>
    </div>
  );
}
