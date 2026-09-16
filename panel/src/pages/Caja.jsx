import { useEffect, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import CajaBar from '../components/CajaBar';
import MetricPill from '../components/MetricPill';

// Pantalla nueva, solo de escritorio (ver feedback-asadmin-movil-congelado):
// hasta ahora la caja solo existía como CajaBar, una barra chica para
// abrir/cerrar pensada para el mostrador — nunca tuvo un lugar para ver
// el HISTORIAL de cajas pasadas (arqueos, diferencias). CajaBar se
// reutiliza tal cual arriba de esta pantalla para no duplicar esa lógica.

const ESTADO_LABEL = { abierta: 'Abierta', cerrada: 'Cerrada' };
const ESTADO_TONO = { abierta: 'bg-accent-soft text-accent', cerrada: 'bg-surface2 text-muted' };
const FILTROS_ESTADO = [
  { id: 'todas', label: 'Todas' },
  { id: 'abierta', label: 'Abiertas' },
  { id: 'cerrada', label: 'Cerradas' },
];

function fechaHoraTexto(fecha) {
  if (!fecha) return '—';
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(fecha));
}

export default function Caja() {
  const { negocio } = useAuth();
  const [sesiones, setSesiones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState('todas');
  const [nombresUsuarios, setNombresUsuarios] = useState({});
  const [sesionAbierta, setSesionAbierta] = useState(null);

  // Ojo: CajaBar (embebida abajo) YA se suscribe sola a 'caja_sesiones' —
  // suscribirse acá también, con el mismo nombre de canal, hacía que
  // Supabase Realtime tirara "cannot add postgres_changes callbacks...
  // after subscribe()" y rompiera toda la pantalla (sin límite de error
  // en React, eso tumbaba el panel entero). En vez de duplicar la
  // suscripción, se reusa el aviso que CajaBar ya manda con cada cambio.
  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio]);

  useEffect(() => {
    if (!negocio) return;
    supabase
      .from('usuarios')
      .select('auth_user_id, nombre')
      .eq('negocio_id', negocio.id)
      .then(({ data }) => {
        const mapa = {};
        for (const u of data || []) mapa[u.auth_user_id] = u.nombre;
        setNombresUsuarios(mapa);
      });
  }, [negocio]);

  function nombreDe(authUserId) {
    if (!authUserId) return 'Sin asignar';
    if (authUserId === negocio.auth_user_id) return negocio.nombre_dueno || 'Vos';
    return nombresUsuarios[authUserId] || 'Ex-empleado';
  }

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from('caja_sesiones')
      .select('*')
      .eq('negocio_id', negocio.id)
      .order('abierta_en', { ascending: false })
      .limit(200);
    setSesiones(data || []);
    setCargando(false);
  }

  const filtradas = sesiones.filter((s) => filtroEstado === 'todas' || s.estado === filtroEstado);
  const cerradas = sesiones.filter((s) => s.estado === 'cerrada');
  const diferenciaAcumulada = cerradas.reduce((acc, s) => acc + Number(s.diferencia || 0), 0);
  const conDiferencia = cerradas.filter((s) => Number(s.diferencia || 0) !== 0).length;

  return (
    <div className="space-y-4">
      <p className="font-display text-xl text-ink">Caja</p>

      <CajaBar negocioId={negocio.id} onSesionActualizada={cargar} />

      <div className="flex gap-3">
        <MetricPill label="Cajas registradas" value={sesiones.length} />
        <MetricPill label="Con diferencia" value={conDiferencia} tone={conDiferencia > 0 ? 'amber' : 'ink'} />
        <MetricPill
          label="Diferencia acumulada"
          value={`Gs. ${diferenciaAcumulada.toLocaleString('es-PY')}`}
          tone={diferenciaAcumulada === 0 ? 'accent' : 'danger'}
          compact
        />
      </div>

      <div className="flex gap-2">
        {FILTROS_ESTADO.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltroEstado(f.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              filtroEstado === f.id ? 'bg-accent text-accent-ink' : 'bg-surface2 text-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {cargando && <p className="pt-6 text-center text-sm text-muted">Cargando…</p>}

      {!cargando && filtradas.length === 0 && (
        <p className="pt-6 text-center text-sm text-muted">Todavía no hay cajas registradas.</p>
      )}

      {filtradas.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Abierta</th>
                <th className="px-4 py-3">Cerrada</th>
                <th className="px-4 py-3">Quién</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Inicial</th>
                <th className="px-4 py-3 text-right">Esperado</th>
                <th className="px-4 py-3 text-right">Real</th>
                <th className="px-4 py-3 text-right">Diferencia</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtradas.map((s) => (
                <tr key={s.id} onClick={() => setSesionAbierta(s)} className="cursor-pointer hover:bg-surface2">
                  <td className="px-4 py-3 text-muted">{fechaHoraTexto(s.abierta_en)}</td>
                  <td className="px-4 py-3 text-muted">{fechaHoraTexto(s.cerrada_en)}</td>
                  <td className="px-4 py-3 text-ink">{nombreDe(s.usuario_id)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_TONO[s.estado]}`}>
                      {ESTADO_LABEL[s.estado]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-ink">Gs. {Number(s.monto_inicial).toLocaleString('es-PY')}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted">
                    {s.monto_esperado === null ? '—' : `Gs. ${Number(s.monto_esperado).toLocaleString('es-PY')}`}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted">
                    {s.monto_real === null ? '—' : `Gs. ${Number(s.monto_real).toLocaleString('es-PY')}`}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${Number(s.diferencia) === 0 ? 'text-accent' : s.diferencia === null ? 'text-muted' : 'text-danger'}`}>
                    {s.diferencia === null ? '—' : `Gs. ${Number(s.diferencia).toLocaleString('es-PY')}`}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight size={14} className="text-muted" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sesionAbierta && (
        <DetalleSesion sesion={sesionAbierta} nombreDe={nombreDe} onCerrar={() => setSesionAbierta(null)} />
      )}
    </div>
  );
}

const TIPO_LABEL = { ingreso: 'Ingreso', egreso: 'Egreso' };

function DetalleSesion({ sesion, nombreDe, onCerrar }) {
  const [movimientos, setMovimientos] = useState(null);

  useEffect(() => {
    supabase
      .from('movimientos_financieros')
      .select('*')
      .eq('caja_sesion_id', sesion.id)
      .order('fecha', { ascending: true })
      .then(({ data }) => setMovimientos(data || []));
  }, [sesion.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCerrar}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-lg text-ink">Caja de {nombreDe(sesion.usuario_id)}</p>
            <p className="text-xs text-muted">
              {fechaHoraTexto(sesion.abierta_en)} — {sesion.cerrada_en ? fechaHoraTexto(sesion.cerrada_en) : 'sigue abierta'}
            </p>
          </div>
          <button onClick={onCerrar} className="shrink-0 text-muted">
            <X size={20} />
          </button>
        </div>

        {sesion.notas && <p className="mt-3 rounded-lg bg-base p-2.5 text-xs text-muted">{sesion.notas}</p>}

        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Movimientos de esta caja</p>

        {movimientos === null && <p className="pt-4 text-center text-sm text-muted">Cargando…</p>}

        {movimientos !== null && movimientos.length === 0 && (
          <p className="pt-4 text-center text-sm text-muted">Sin movimientos cargados en esta caja.</p>
        )}

        {movimientos !== null && movimientos.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {movimientos.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-lg bg-base px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-ink">{m.categoria || TIPO_LABEL[m.tipo]}</p>
                  {m.notas && <p className="truncate text-xs text-muted">{m.notas}</p>}
                </div>
                <p className={`shrink-0 font-mono text-xs ${m.tipo === 'ingreso' ? 'text-accent' : 'text-danger'}`}>
                  {m.tipo === 'ingreso' ? '+' : '−'} Gs. {Number(m.monto).toLocaleString('es-PY')}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
