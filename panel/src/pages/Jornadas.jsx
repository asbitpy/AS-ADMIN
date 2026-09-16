import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, LogIn, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useRealtimeTick } from '../lib/realtime';

// Pantalla nueva, solo de escritorio (ver feedback-asadmin-movil-congelado):
// primera parte de "Jornadas del equipo" — el fichaje real de entrada y
// salida, comparado contra el horario de referencia que ya existía
// (Equipo → ficha de cada persona, migración 022). A propósito NO
// incluye comisiones — esa cuenta depende de reglas de negocio que
// todavía no están definidas (¿por venta? ¿por servicio? ¿porcentaje
// fijo o por escalón?), inventarlas acá sería adivinar en vez de
// preguntar. Fichar (entrada/salida) queda acá mismo, para cualquiera
// del equipo, no solo para quien puede configurar.

const DIAS = [
  { id: 'lun', label: 'Lun' },
  { id: 'mar', label: 'Mar' },
  { id: 'mie', label: 'Mié' },
  { id: 'jue', label: 'Jue' },
  { id: 'vie', label: 'Vie' },
  { id: 'sab', label: 'Sáb' },
  { id: 'dom', label: 'Dom' },
];

function inicioSemana(offset) {
  const hoy = new Date();
  const dia = hoy.getDay();
  const diffLunes = dia === 0 ? -6 : 1 - dia;
  const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + diffLunes + offset * 7);
  lunes.setHours(0, 0, 0, 0);
  return lunes;
}

function horaCorta(fecha) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(fecha));
}

export default function Jornadas() {
  const { negocio, session } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [semanaOffset, setSemanaOffset] = useState(0);
  const [fichajesSemana, setFichajesSemana] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [fichando, setFichando] = useState(false);

  const tickFichajes = useRealtimeTick('fichajes', negocio?.id);

  useEffect(() => {
    if (!negocio) return;
    cargarUsuarios();
  }, [negocio]);

  useEffect(() => {
    if (!negocio) return;
    cargarSemana();
  }, [negocio, semanaOffset, tickFichajes]);

  async function cargarUsuarios() {
    const { data } = await supabase
      .from('usuarios')
      .select('id, nombre, auth_user_id, horario, activo')
      .eq('negocio_id', negocio.id)
      .eq('activo', true)
      .order('nombre');
    setUsuarios(data || []);
  }

  async function cargarSemana() {
    setCargando(true);
    const lunes = inicioSemana(semanaOffset);
    const domingoFin = new Date(lunes.getTime() + 7 * 86400000);
    const { data } = await supabase
      .from('fichajes')
      .select('*')
      .eq('negocio_id', negocio.id)
      .gte('entrada', lunes.toISOString())
      .lt('entrada', domingoFin.toISOString())
      .order('entrada');
    setFichajesSemana(data || []);
    setCargando(false);
  }

  const dias = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(inicioSemana(semanaOffset).getTime() + i * 86400000)),
    [semanaOffset]
  );
  const hoyStr = new Date().toDateString();

  const rangoTexto = `${dias[0].toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit' })} – ${dias[6].toLocaleDateString(
    'es-PY',
    { day: '2-digit', month: '2-digit' }
  )}`;

  const filas = [
    { id: 'dueno', nombre: negocio?.nombre_dueno || 'Vos', authId: negocio?.auth_user_id, horario: negocio?.config?.horarios || {} },
    ...usuarios.map((u) => ({ id: u.id, nombre: u.nombre, authId: u.auth_user_id, horario: u.horario || {} })),
  ];

  const miAuthId = session?.user?.id;
  const miFichajeAbierto = fichajesSemana.find((f) => f.usuario_id === miAuthId && !f.salida);

  async function fichar() {
    setFichando(true);
    if (miFichajeAbierto) {
      await supabase.from('fichajes').update({ salida: new Date().toISOString() }).eq('id', miFichajeAbierto.id);
    } else {
      await supabase.from('fichajes').insert({ negocio_id: negocio.id, usuario_id: miAuthId });
    }
    setFichando(false);
    cargarSemana();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-xl text-ink">Jornadas</p>
        <button
          onClick={fichar}
          disabled={fichando}
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium disabled:opacity-60 ${
            miFichajeAbierto ? 'bg-danger-soft text-danger' : 'bg-accent text-accent-ink'
          }`}
        >
          {miFichajeAbierto ? <LogOut size={15} /> : <LogIn size={15} />}
          {fichando ? 'Guardando…' : miFichajeAbierto ? `Fichar salida (entró ${horaCorta(miFichajeAbierto.entrada)})` : 'Fichar entrada'}
        </button>
      </div>

      <p className="rounded-xl bg-accent-soft px-3 py-2 text-xs text-accent">
        Comparación entre el horario de referencia de cada persona (cargado en Equipo) y el fichaje real de esta
        semana. Todavía sin comisiones — eso depende de reglas de negocio que faltan definir.
      </p>

      <div className="flex items-center gap-2">
        <button onClick={() => setSemanaOffset((o) => o - 1)} className="rounded-lg p-1.5 text-muted hover:bg-surface2">
          <ChevronLeft size={18} />
        </button>
        <button onClick={() => setSemanaOffset(0)} className="rounded-full bg-surface2 px-3 py-1 text-xs font-medium text-ink">
          Esta semana
        </button>
        <button onClick={() => setSemanaOffset((o) => o + 1)} className="rounded-lg p-1.5 text-muted hover:bg-surface2">
          <ChevronRight size={18} />
        </button>
        <p className="text-sm text-muted">{rangoTexto}</p>
      </div>

      {cargando ? (
        <p className="pt-6 text-center text-sm text-muted">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Persona</th>
                {dias.map((d, i) => (
                  <th key={i} className={`px-3 py-3 text-center ${d.toDateString() === hoyStr ? 'text-accent' : ''}`}>
                    {DIAS[i].label} {d.getDate()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filas.map((fila) => (
                <tr key={fila.id}>
                  <td className="px-4 py-3 font-medium text-ink">{fila.nombre}</td>
                  {DIAS.map((dia, i) => {
                    const bloquesPlan = fila.horario[dia.id] || [];
                    const fecha = dias[i];
                    const fichajesDia = fichajesSemana.filter(
                      (f) => f.usuario_id === fila.authId && new Date(f.entrada).toDateString() === fecha.toDateString()
                    );
                    return (
                      <td key={dia.id} className="px-3 py-3 text-center align-top">
                        <p className="text-[11px] text-muted">{bloquesPlan.length > 0 ? bloquesPlan.join(' · ') : 'Libre'}</p>
                        {fichajesDia.map((f) => (
                          <p key={f.id} className="mt-0.5 font-mono text-[11px] text-accent">
                            {horaCorta(f.entrada)}–{f.salida ? horaCorta(f.salida) : '…'}
                          </p>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
