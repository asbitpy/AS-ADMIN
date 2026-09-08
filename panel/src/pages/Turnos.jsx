import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import TurnoCard from '../components/TurnoCard';

const FILTROS = [
  { id: 'proximos', label: 'Próximos' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'todos', label: 'Todos' },
];

export default function Turnos() {
  const { negocio } = useAuth();
  const [filtro, setFiltro] = useState('proximos');
  const [turnos, setTurnos] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio, filtro]);

  async function cargar() {
    setCargando(true);
    let query = supabase
      .from('turnos')
      .select('*, cliente:clientes(nombre, telefono), servicio:servicios(nombre)')
      .eq('negocio_id', negocio.id)
      .order('fecha_hora', { ascending: filtro !== 'todos' });

    if (filtro === 'proximos') {
      query = query.gte('fecha_hora', new Date().toISOString()).limit(30);
    } else if (filtro === 'semana') {
      const hasta = new Date(Date.now() + 7 * 86400000).toISOString();
      query = query.gte('fecha_hora', new Date().toISOString()).lte('fecha_hora', hasta);
    } else {
      query = query.limit(50);
    }

    const { data } = await query;
    setTurnos(data || []);
    setCargando(false);
  }

  async function onCambiarEstado(turnoId, nuevoEstado) {
    await supabase.from('turnos').update({ estado: nuevoEstado }).eq('id', turnoId);
    cargar();
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium ${
              filtro === f.id ? 'bg-accent text-white' : 'bg-surface text-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {cargando && <p className="pt-6 text-center text-sm text-muted">Cargando…</p>}

      {!cargando && turnos.length === 0 && (
        <p className="pt-6 text-center text-sm text-muted">No hay turnos para mostrar acá.</p>
      )}

      <div className="space-y-3">
        {turnos.map((t) => (
          <TurnoCard key={t.id} turno={t} onCambiarEstado={onCambiarEstado} />
        ))}
      </div>
    </div>
  );
}
