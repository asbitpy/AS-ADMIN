import { NavLink, Outlet } from 'react-router-dom';
import { CalendarHeart, CalendarDays, Settings, Package, ShoppingCart } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { negocio } = useAuth();
  const modulos = negocio?.modulos_activos || ['agenda'];
  const tieneRetail = modulos.includes('inventario') || modulos.includes('pos');
  const tieneAgenda = modulos.includes('agenda');

  const tabs = [
    tieneAgenda && { to: '/', label: 'Hoy', icon: CalendarHeart, end: true },
    tieneAgenda && { to: '/turnos', label: 'Turnos', icon: CalendarDays },
    tieneRetail && { to: tieneAgenda ? '/vender' : '/', label: 'Vender', icon: ShoppingCart, end: !tieneAgenda },
    tieneRetail && { to: '/productos', label: 'Productos', icon: Package },
    { to: '/configuracion', label: 'Config', icon: Settings },
  ].filter(Boolean);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-base">
      <header className="flex items-center justify-between px-5 pb-2 pt-6">
        <div>
          <p className="text-xs text-muted">AS ADMIN</p>
          <h1 className="font-display text-lg font-semibold text-ink">{negocio?.nombre}</h1>
        </div>
      </header>

      <main className="flex-1 px-5 pb-24 pt-2">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-line bg-surface/95 backdrop-blur">
        <div className="flex">
          {tabs.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium ${
                  isActive ? 'text-accent' : 'text-muted'
                }`
              }
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
