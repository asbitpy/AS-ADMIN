import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  CalendarHeart,
  CalendarDays,
  Settings,
  Package,
  ShoppingCart,
  Receipt,
  Users,
  UserCog,
  LogOut,
  Wallet,
  Truck,
  ClipboardList,
  MessageCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useEsEscritorio } from '../hooks/useEsEscritorio';
import SelectorVistaDev from './SelectorVistaDev';

const ETIQUETAS_ROL = {
  dueno: 'Dueño',
  gerente: 'Gerente',
  cajero: 'Cajero',
  vendedor: 'Vendedor',
  profesional: 'Profesional',
};

export default function Layout() {
  const { negocio, usuario, rol, esDueno, signOut } = useAuth();
  const { esEscritorio, forzado, forzar } = useEsEscritorio();
  const modulos = negocio?.modulos_activos || ['agenda'];
  const tieneRetail = modulos.includes('inventario') || modulos.includes('pos');
  const tieneAgenda = modulos.includes('agenda');
  // Config toca datos del negocio (horarios, precios, módulos): solo
  // para quien puede tomar esas decisiones. Un cajero o vendedor no la ve.
  const puedeConfigurar = rol === 'dueno' || rol === 'gerente';

  // Estirar el diseño de celular a una pantalla grande sin más queda
  // "una columna flaca en un mar de negro" — todo se ve chico porque el
  // tamaño base de Tailwind (rem) sigue pensado para un teléfono. Se
  // sube el font-size raíz del documento: como el texto Y los
  // espaciados de Tailwind son rem, todo escala junto. Este efecto vive
  // ACÁ (Layout no se desmonta al navegar entre pantallas) y en ningún
  // otro lado — tenerlo también en useEsEscritorio.js hacía que cada
  // pantalla, al montarse/desmontarse en cada navegación, reseteara y
  // volviera a poner el tamaño, y eso se veía como que la pantalla
  // "saltaba" de tamaño cada vez que se tocaba un panel distinto.
  useEffect(() => {
    document.documentElement.style.fontSize = esEscritorio ? '20px' : '';
    return () => {
      document.documentElement.style.fontSize = '';
    };
  }, [esEscritorio]);

  // 'grupo' solo lo usa la barra lateral de escritorio (sección 4 de
  // AS_ADMIN_pantallas_y_escritorio_v1.md) para separar visualmente
  // Atender / Vender / Administrar — la navegación de celular ignora
  // este campo y sigue mostrando la lista plana de siempre.
  const tabs = [
    tieneAgenda && { to: '/', label: 'Hoy', icon: CalendarHeart, end: true, grupo: 'inicio' },
    tieneAgenda && { to: '/turnos', label: 'Turnos', icon: CalendarDays, grupo: 'atender' },
    // Sin agenda, "/" es la portada de retail (HoyRetail) en vez de Vender.
    !tieneAgenda && tieneRetail && { to: '/', label: 'Hoy', icon: CalendarHeart, end: true, grupo: 'inicio' },
    tieneRetail && { to: '/vender', label: 'Vender', icon: ShoppingCart, grupo: 'vender' },
    tieneRetail && { to: '/ventas', label: 'Ventas', icon: Receipt, grupo: 'vender' },
    tieneRetail && { to: '/productos', label: 'Productos', icon: Package, grupo: 'vender' },
    // Clientes es del núcleo común: sirve tanto a servicio como a retail
    { to: '/clientes', label: 'Clientes', icon: Users, grupo: 'atender' },
    puedeConfigurar && { to: '/finanzas', label: 'Finanzas', icon: Wallet, grupo: 'administrar' },
    esDueno && { to: '/equipo', label: 'Equipo', icon: UserCog, grupo: 'administrar' },
    puedeConfigurar && { to: '/configuracion', label: 'Config', icon: Settings, grupo: 'administrar' },
  ].filter(Boolean);

  // Con más de 5 pestañas la barra queda apretada en un celular chico:
  // se sacan las etiquetas y quedan solo los íconos.
  const compacta = tabs.length > 5;

  const GRUPOS = [
    { id: 'atender', titulo: 'Atender' },
    { id: 'vender', titulo: 'Vender' },
    { id: 'administrar', titulo: 'Administrar' },
  ];

  // Proveedores, Compras y Conversaciones son pantallas nuevas, solo de
  // escritorio (ver feedback-asadmin-movil-congelado): a propósito NO se
  // agregan al array 'tabs' de arriba, que también alimenta la
  // navegación de celular — viven solo acá, en lo que se pinta dentro
  // de <aside>.
  const enlacesSoloEscritorio = {
    atender: [{ to: '/conversaciones', label: 'Conversaciones', icon: MessageCircle }],
    vender:
      tieneRetail && puedeConfigurar
        ? [
            { to: '/proveedores', label: 'Proveedores', icon: Truck },
            { to: '/compras', label: 'Compras', icon: ClipboardList },
          ]
        : [],
  };

  return (
    <div className="flex min-h-screen bg-base">
      {/* Barra lateral — desde 1280px reales, o forzada en desarrollo
          (ver sección 0 y 4 del doc de pantallas y escritorio, y
          useEsEscritorio.js). En modo celular no se renderiza nada
          distinto: es exactamente el panel de siempre. */}
      <aside
        className={`sticky top-0 h-screen w-60 shrink-0 flex-col border-r border-line bg-surface ${
          esEscritorio ? 'flex' : 'hidden'
        }`}
      >
        <div className="px-5 pb-4 pt-6">
          <p className="text-xs text-muted">AS ADMIN{!esDueno ? ` · ${ETIQUETAS_ROL[rol] || rol}` : ''}</p>
          <h1 className="truncate font-display text-lg font-semibold text-ink">{negocio?.nombre}</h1>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
          {tabs
            .filter((t) => t.grupo === 'inicio')
            .map(({ to, label, icon: Icon, end }) => (
              <EnlaceEscritorio key={to} to={to} label={label} Icon={Icon} end={end} />
            ))}

          {GRUPOS.map((g) => {
            const items = [...tabs.filter((t) => t.grupo === g.id), ...(enlacesSoloEscritorio[g.id] || [])];
            if (items.length === 0) return null;
            return (
              <div key={g.id}>
                <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted">{g.titulo}</p>
                <div className="space-y-0.5">
                  {items.map(({ to, label, icon: Icon, end }) => (
                    <EnlaceEscritorio key={to} to={to} label={label} Icon={Icon} end={end} />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-line px-3 py-3">
          {!esDueno && usuario?.nombre && <p className="truncate px-3 pb-2 text-xs text-muted">{usuario.nombre}</p>}
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted active:text-danger"
          >
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
      </aside>

      <div
        className={`mx-auto flex min-h-screen w-full flex-1 flex-col ${esEscritorio ? '' : 'max-w-md'}`}
      >
        <header
          className={`flex items-center justify-between px-5 pb-2 pt-6 ${esEscritorio ? 'hidden' : 'flex'}`}
        >
          <div className="min-w-0">
            <p className="text-xs text-muted">AS ADMIN{!esDueno ? ` · ${ETIQUETAS_ROL[rol] || rol}` : ''}</p>
            <h1 className="truncate font-display text-lg font-semibold text-ink">{negocio?.nombre}</h1>
            {!esDueno && usuario?.nombre && <p className="text-xs text-muted">{usuario.nombre}</p>}
          </div>
          {/* Siempre visible sin importar el rol: si Config está oculta
              (cajero, vendedor) no puede quedar sin forma de salir. */}
          <button
            onClick={signOut}
            title="Cerrar sesión"
            className="shrink-0 rounded-full p-2 text-muted active:text-danger"
          >
            <LogOut size={18} />
          </button>
        </header>

        <main className={esEscritorio ? 'flex-1 px-10 py-8' : 'flex-1 px-5 pb-24 pt-2'}>
          <Outlet />
        </main>

        <nav
          className={`fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-line bg-surface/95 backdrop-blur ${
            esEscritorio ? 'hidden' : 'block'
          }`}
        >
          <div className="flex">
            {tabs.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                className={({ isActive }) =>
                  `flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium ${
                    isActive ? 'text-accent' : 'text-muted'
                  }`
                }
              >
                <Icon size={20} />
                {!compacta && label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>

      <SelectorVistaDev esEscritorio={esEscritorio} forzado={forzado} forzar={forzar} />
    </div>
  );
}

function EnlaceEscritorio({ to, label, Icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${
          isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
        }`
      }
    >
      <Icon size={18} />
      {label}
    </NavLink>
  );
}
