import { useId, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { LinkWizard } from '@/features/account/LinkWizard';
import { useAccount } from '@/features/account/account-context';
import { validateCredentials } from '@/features/account/credentials';

function SignInForm() {
  const account = useAccount();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState('');
  const errors = submitted ? validateCredentials(email, password) : {};
  const emailId = useId();
  const passwordId = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setFailure('');
    if (Object.keys(validateCredentials(email, password)).length) return;
    setBusy(true);
    try {
      await account.signIn(email, password);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'No pudimos iniciar sesión. Probá de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  if (!account.configured) {
    return (
      <div className="stack">
        <p className="notice warn" role="status">
          <Icon name="cloud-off" size={16} />
          <span>
            Esta versión de GuitarAP todavía no tiene la nube conectada, por eso no se puede iniciar sesión.
            Podés seguir usándola: todo se guarda en este dispositivo.
          </span>
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={account.closeDialog}>
            Entendido
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
      <p className="muted">
        Entrá con tu cuenta para sincronizar tus materiales entre dispositivos. Sin cuenta, todo se
        guarda en este dispositivo.
      </p>
      <div className="field">
        <label htmlFor={emailId}>Correo</label>
        <input
          id={emailId}
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'auth-email-error' : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
        {errors.email && (
          <small id="auth-email-error" className="field-error">
            {errors.email}
          </small>
        )}
      </div>
      <div className="field">
        <label htmlFor={passwordId}>Contraseña</label>
        <span className="field-row">
          <input
            id={passwordId}
            type={visible ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'auth-password-error' : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={visible}
            onClick={() => setVisible((value) => !value)}
          >
            <Icon name={visible ? 'eye-off' : 'eye'} />
          </button>
        </span>
        {errors.password && (
          <small id="auth-password-error" className="field-error">
            {errors.password}
          </small>
        )}
      </div>
      {failure && (
        <p role="alert" className="notice danger">
          <Icon name="alert" size={16} />
          <span>{failure}</span>
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={account.closeDialog}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Entrando…' : 'Iniciar sesión'}
        </button>
      </div>
    </form>
  );
}

export function AuthDialog() {
  const account = useAccount();
  if (!account.dialog) return null;
  if (account.dialog === 'protect' && account.session) {
    return (
      <Dialog title="Protegé tu biblioteca antes de sincronizar" onClose={account.closeDialog} size="lg">
        <p className="muted">
          Entraste como <strong>{account.email}</strong>. Antes de subir nada, guardá una copia por seguridad.
        </p>
        <LinkWizard />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={account.closeDialog}>
            Ahora no
          </button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title="Iniciar sesión" onClose={account.closeDialog} size="sm">
      <SignInForm />
    </Dialog>
  );
}
