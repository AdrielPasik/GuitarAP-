import { Link, NavLink, Outlet } from 'react-router-dom';
import { LogoMark } from '@/components/brand/Logo';
import { Icon } from '@/components/ui/Icon';
import { AccountMenu } from '@/features/account/AccountMenu';
import { AuthDialog } from '@/features/account/AuthDialog';
import { MetronomeBar } from '@/features/metronome/MetronomeBar';
import { ThemeToggle } from '@/features/theme/ThemeToggle';

const navigation = [
  { to: '/biblioteca', label: 'Biblioteca', icon: 'library' as const },
  { to: '/practica', label: 'Práctica', icon: 'practice' as const },
  { to: '/configuracion', label: 'Configuración', icon: 'settings' as const },
];

/** One slim bar: identity, the two places you work in, the metronome, and your account. */
export function AppShell() {
  return (
    <div className="app">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="topbar" role="banner">
        <Link className="brand" to="/biblioteca" aria-label="GuitarAP, ir a la biblioteca">
          <span className="brand-mark">
            <LogoMark size={30} />
          </span>
          <span className="brand-name">Guitar<span className="ap">AP</span></span>
        </Link>
        <nav className="topbar-nav" aria-label="Secciones principales">
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          <MetronomeBar />
          <AccountMenu />
          <ThemeToggle />
        </div>
      </header>
      <main className="main" id="contenido" tabIndex={-1}>
        <Outlet />
      </main>
      <AuthDialog />
    </div>
  );
}
