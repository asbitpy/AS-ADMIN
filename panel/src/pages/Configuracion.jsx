import { useEffect, useState } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import HorariosAtencion from '../components/HorariosAtencion';
import { PALETA_ACCENT, ACCENT_POR_DEFECTO } from '../lib/temaAccent';

export default function Configuracion() {
  const { negocio, actualizarConfigLocal } = useAuth();
  const [guardandoColor, setGuardandoColor] = useState(false);
  const [servicios, setServicios] = useState([]);
  const [profesionales, setProfesionales] = useState([]);
  const [feriados, setFeriados] = useState([]);
  const [nuevoServicio, setNuevoServicio] = useState({ nombre: '', precio: '', duracion_minutos: 30 });
  const [nuevoProfesional, setNuevoProfesional] = useState('');
  const [nuevoFeriado, setNuevoFeriado] = useState({ fecha: '', motivo: '' });
  const [direccion, setDireccion] = useState(negocio?.direccion || '');
  const [sitioWeb, setSitioWeb] = useState(negocio?.sitio_web_url || '');
  const [guardando, setGuardando] = useState(false);
  const [guardandoSitio, setGuardandoSitio] = useState(false);

  const tieneEcommerce = (negocio?.modulos_activos || []).includes('ecommerce');
  const tieneAgenda = (negocio?.modulos_activos || []).includes('agenda');
  const colorAcentoActual = negocio?.config?.color_acento || ACCENT_POR_DEFECTO;

  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio]);

  async function cargar() {
    const [s, p, f] = await Promise.all([
      supabase.from('servicios').select('*').eq('negocio_id', negocio.id).eq('activo', true).order('nombre'),
      supabase.from('profesionales').select('*').eq('negocio_id', negocio.id).eq('activo', true).order('nombre'),
      supabase.from('feriados_excepciones').select('*').eq('negocio_id', negocio.id).order('fecha'),
    ]);
    setServicios(s.data || []);
    setProfesionales(p.data || []);
    setFeriados(f.data || []);
  }

  async function guardarDireccion() {
    setGuardando(true);
    await supabase.from('negocios').update({ direccion }).eq('id', negocio.id);
    setGuardando(false);
  }

  async function guardarSitioWeb() {
    setGuardandoSitio(true);
    await supabase.from('negocios').update({ sitio_web_url: sitioWeb || null }).eq('id', negocio.id);
    setGuardandoSitio(false);
  }

  async function elegirColorAcento(id) {
    if (id === colorAcentoActual || guardandoColor) return;
    setGuardandoColor(true);

    // Mismo cuidado que en horarios: releer config fresco antes de
    // escribir, para no pisar otra clave (telefono_dueno, horarios...)
    // si cambió por otro lado mientras tanto.
    const { data: fresco, error: errFetch } = await supabase
      .from('negocios')
      .select('config')
      .eq('id', negocio.id)
      .single();

    if (!errFetch) {
      const { error: errUpdate } = await supabase
        .from('negocios')
        .update({ config: { ...(fresco.config || {}), color_acento: id } })
        .eq('id', negocio.id);
      if (!errUpdate) actualizarConfigLocal({ color_acento: id });
    }

    setGuardandoColor(false);
  }

  async function agregarServicio(e) {
    e.preventDefault();
    if (!nuevoServicio.nombre || !nuevoServicio.precio) return;
    await supabase.from('servicios').insert({
      negocio_id: negocio.id,
      nombre: nuevoServicio.nombre,
      precio: Number(nuevoServicio.precio),
      duracion_minutos: Number(nuevoServicio.duracion_minutos) || 30,
    });
    setNuevoServicio({ nombre: '', precio: '', duracion_minutos: 30 });
    cargar();
  }

  async function borrarServicio(id) {
    await supabase.from('servicios').update({ activo: false }).eq('id', id);
    cargar();
  }

  async function agregarProfesional(e) {
    e.preventDefault();
    if (!nuevoProfesional.trim()) return;
    await supabase.from('profesionales').insert({ negocio_id: negocio.id, nombre: nuevoProfesional.trim() });
    setNuevoProfesional('');
    cargar();
  }

  async function borrarProfesional(id) {
    await supabase.from('profesionales').update({ activo: false }).eq('id', id);
    cargar();
  }

  async function agregarFeriado(e) {
    e.preventDefault();
    if (!nuevoFeriado.fecha) return;
    await supabase
      .from('feriados_excepciones')
      .insert({ negocio_id: negocio.id, fecha: nuevoFeriado.fecha, motivo: nuevoFeriado.motivo });
    setNuevoFeriado({ fecha: '', motivo: '' });
    cargar();
  }

  async function borrarFeriado(id) {
    await supabase.from('feriados_excepciones').delete().eq('id', id);
    cargar();
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Datos del negocio</p>
        <div className="mt-2 rounded-2xl bg-surface p-4 shadow-card">
          <label className="text-xs text-muted">Dirección</label>
          <div className="mt-1 flex gap-2">
            <input
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              onClick={guardarDireccion}
              disabled={guardando}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink"
            >
              Guardar
            </button>
          </div>

          {tieneAgenda && (
            <div className="mt-3">
              <HorariosAtencion negocioId={negocio.id} configActual={negocio.config} />
            </div>
          )}
        </div>
      </section>

      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Apariencia</p>
        <div className="mt-2 rounded-2xl bg-surface p-4 shadow-card">
          <p className="text-xs text-muted">
            El color de acento se usa en botones, precios y la pestaña activa de todo el panel.
          </p>
          <div className="mt-3 flex gap-3">
            {PALETA_ACCENT.map((c) => {
              const seleccionado = c.id === colorAcentoActual;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => elegirColorAcento(c.id)}
                  disabled={guardandoColor}
                  title={c.nombre}
                  className="flex flex-col items-center gap-1"
                >
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-surface disabled:opacity-60"
                    style={{
                      backgroundColor: `rgb(${c.rgb})`,
                      '--tw-ring-color': seleccionado ? `rgb(${c.rgb})` : 'transparent',
                    }}
                  >
                    {seleccionado && <Check size={16} color={c.ink} strokeWidth={3} />}
                  </span>
                  <span className="text-[10px] text-muted">{c.nombre}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Tienda online</p>
        <div className="mt-2 rounded-2xl bg-surface p-4 shadow-card">
          {tieneEcommerce ? (
            <p className="text-xs text-accent">
              Módulo de ecommerce activo: el catálogo de productos activos está disponible para que un
              sitio externo lo lea (precio, foto y si hay stock — nada más).
            </p>
          ) : (
            <p className="text-xs text-muted">
              Este negocio todavía no tiene el módulo de ecommerce activado. Pedile a AS BIT que lo
              habilite si querés conectar una tienda online al mismo catálogo e inventario.
            </p>
          )}

          <label className="mt-3 block text-xs text-muted">Link de tu tienda online (si tenés)</label>
          <div className="mt-1 flex gap-2">
            <input
              placeholder="https://tutienda.com.py"
              value={sitioWeb}
              onChange={(e) => setSitioWeb(e.target.value)}
              className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              onClick={guardarSitioWeb}
              disabled={guardandoSitio}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink disabled:opacity-60"
            >
              Guardar
            </button>
          </div>
        </div>
      </section>

      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Servicios y precios</p>
        <div className="mt-2 space-y-2">
          {servicios.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-card">
              <div>
                <p className="text-sm font-medium text-ink">{s.nombre}</p>
                <p className="text-xs text-muted">
                  Gs. {Number(s.precio).toLocaleString('es-PY')} · {s.duracion_minutos} min
                </p>
              </div>
              <button onClick={() => borrarServicio(s.id)} className="rounded-full p-2 text-muted active:text-danger">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={agregarServicio} className="mt-3 space-y-2 rounded-xl bg-surface p-3 shadow-card">
          <input
            placeholder="Nombre del servicio"
            value={nuevoServicio.nombre}
            onChange={(e) => setNuevoServicio({ ...nuevoServicio, nombre: e.target.value })}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
          />
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Precio Gs."
              value={nuevoServicio.precio}
              onChange={(e) => setNuevoServicio({ ...nuevoServicio, precio: e.target.value })}
              className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="number"
              placeholder="Min."
              value={nuevoServicio.duracion_minutos}
              onChange={(e) => setNuevoServicio({ ...nuevoServicio, duracion_minutos: e.target.value })}
              className="w-20 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <button className="flex w-full items-center justify-center gap-1 rounded-lg bg-accent-soft py-2 text-xs font-medium text-accent">
            <Plus size={14} /> Agregar servicio
          </button>
        </form>
      </section>

      {tieneAgenda && (
        <section>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Profesionales</p>
          <p className="mt-1 text-xs text-muted">
            Con más de uno cargado, el bot le pregunta al cliente con quién prefiere antes de mostrarle horarios.
          </p>
          <div className="mt-2 space-y-2">
            {profesionales.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-card">
                <p className="text-sm font-medium text-ink">{p.nombre}</p>
                <button onClick={() => borrarProfesional(p.id)} className="rounded-full p-2 text-muted active:text-danger">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>

          <form onSubmit={agregarProfesional} className="mt-3 flex gap-2 rounded-xl bg-surface p-3 shadow-card">
            <input
              placeholder="Nombre del profesional"
              value={nuevoProfesional}
              onChange={(e) => setNuevoProfesional(e.target.value)}
              className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
            />
            <button className="rounded-lg bg-accent-soft px-3 py-2 text-xs font-medium text-accent">
              <Plus size={14} />
            </button>
          </form>
        </section>
      )}

      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Feriados y excepciones</p>
        <div className="mt-2 space-y-2">
          {feriados.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-card">
              <div>
                <p className="text-sm font-medium text-ink">{f.fecha}</p>
                {f.motivo && <p className="text-xs text-muted">{f.motivo}</p>}
              </div>
              <button onClick={() => borrarFeriado(f.id)} className="rounded-full p-2 text-muted active:text-danger">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={agregarFeriado} className="mt-3 flex gap-2 rounded-xl bg-surface p-3 shadow-card">
          <input
            type="date"
            value={nuevoFeriado.fecha}
            onChange={(e) => setNuevoFeriado({ ...nuevoFeriado, fecha: e.target.value })}
            className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
          />
          <button className="rounded-lg bg-accent-soft px-3 py-2 text-xs font-medium text-accent">
            <Plus size={14} />
          </button>
        </form>
      </section>
    </div>
  );
}
