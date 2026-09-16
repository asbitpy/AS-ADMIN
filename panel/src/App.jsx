import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Hoy from './pages/Hoy';
import HoyRetail from './pages/HoyRetail';
import Turnos from './pages/Turnos';
import Venta from './pages/Venta';
import Ventas from './pages/Ventas';
import Productos from './pages/Productos';
import Clientes from './pages/Clientes';
import Equipo from './pages/Equipo';
import Finanzas from './pages/Finanzas';
import Configuracion from './pages/Configuracion';
import Proveedores from './pages/Proveedores';
import Compras from './pages/Compras';
import Conversaciones from './pages/Conversaciones';
import Caja from './pages/Caja';
import Inventario from './pages/Inventario';
import Jornadas from './pages/Jornadas';
import AdminNegocios from './pages/AdminNegocios';
import { useEsEscritorio } from './hooks/useEsEscritorio';

export default function App() {
  const { session, negocio, cargando, esDueno, rol } = useAuth();
  const { esEscritorio } = useEsEscritorio();

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base">
        <p className="text-sm text-muted">Cargando…</p>
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  const modulos = negocio?.modulos_activos || ['agenda'];
  const tieneAgenda = modulos.includes('agenda');
  const tieneRetail = modulos.includes('inventario') || modulos.includes('pos');
  // Config toca datos del negocio: solo dueño/gerente. Un cajero o
  // vendedor que teclee la URL a mano cae a "/", no ve el formulario.
  const puedeConfigurar = rol === 'dueno' || rol === 'gerente';

  return (
    <Routes>
      {/* Herramienta interna de AS BIT (alta de negocios clientes) — NO
          depende de tener un 'negocio' propio vinculado, por eso vive
          afuera del ternario de abajo. Se protege sola adentro
          (fn_es_staff_asbit, migración 028): cualquiera que no sea del
          equipo de AS BIT ve "No tenés acceso" y nada más. */}
      <Route path="/asbit/negocios" element={<AdminNegocios />} />

      {!negocio ? (
        <Route
          path="*"
          element={
            <div className="flex min-h-screen items-center justify-center bg-base px-6 text-center">
              <p className="text-sm text-muted">
                Tu usuario no está vinculado a ningún negocio todavía. Pedile a AS BIT que complete el alta.
              </p>
            </div>
          }
        />
      ) : (
        <Route element={<Layout />}>
          {/* La home cambia según los módulos activos del negocio (ver
              AS_ADMIN_arquitectura_unificada_v3.md, sección 3):
              servicio -> Hoy, retail -> HoyRetail (resumen del día +
              caja), sin ninguno -> Productos */}
          <Route path="/" element={tieneAgenda ? <Hoy /> : tieneRetail ? <HoyRetail /> : <Productos />} />
          {tieneAgenda && <Route path="/turnos" element={<Turnos />} />}
          {tieneRetail && <Route path="/vender" element={<Venta />} />}
          {tieneRetail && <Route path="/ventas" element={<Ventas />} />}
          {tieneRetail && <Route path="/productos" element={<Productos />} />}
          {/* Clientes es del núcleo común: sirve tanto a servicio como a retail */}
          <Route path="/clientes" element={<Clientes />} />
          {/* Conversaciones: pantalla nueva, solo escritorio (ver
              feedback-asadmin-movil-congelado). Sin restricción de rol ni
              de módulo, igual que Clientes — el bot de WhatsApp corre para
              cualquier negocio y cualquiera del equipo puede necesitar
              revisar una conversación derivada. */}
          {esEscritorio && <Route path="/conversaciones" element={<Conversaciones />} />}
          {/* Jornadas: fichaje de entrada/salida, sin restricción de rol
              (cualquiera del equipo ficha su propia jornada) ni de módulo
              (sirve tanto a agenda como a retail). */}
          {esEscritorio && <Route path="/jornadas" element={<Jornadas />} />}
          {puedeConfigurar && <Route path="/finanzas" element={<Finanzas />} />}
          {esDueno && <Route path="/equipo" element={<Equipo />} />}
          {puedeConfigurar && <Route path="/configuracion" element={<Configuracion />} />}
          {/* Proveedores, Compras, Caja e Inventario: pantallas nuevas,
              solo escritorio (ver feedback-asadmin-movil-congelado).
              Mismo nivel de acceso que Finanzas: decisión de gerencia,
              no de mostrador. */}
          {esEscritorio && tieneRetail && puedeConfigurar && <Route path="/proveedores" element={<Proveedores />} />}
          {esEscritorio && tieneRetail && puedeConfigurar && <Route path="/compras" element={<Compras />} />}
          {esEscritorio && tieneRetail && puedeConfigurar && <Route path="/caja" element={<Caja />} />}
          {esEscritorio && tieneRetail && puedeConfigurar && <Route path="/inventario" element={<Inventario />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  );
}
