import { useEffect, useState } from 'react';
import { Plus, X, Phone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// Pantalla nueva de escritorio (ver feedback-asadmin-movil-congelado):
// 'proveedores' existe en la base desde la migración 004 pero nunca
// tuvo pantalla. Mismo patrón de siempre — lista + diálogo de alta,
// soft-delete con 'activo' (agregado en la migración 024, el resto del
// sistema ya lo usaba así).
export default function Proveedores() {
  const { negocio } = useAuth();
  const [proveedores, setProveedores] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [vistaForm, setVistaForm] = useState(false);
  const [editando, setEditando] = useState(null); // proveedor | null (null = alta nueva)

  const [nombre, setNombre] = useState('');
  const [contacto, setContacto] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio]);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from('proveedores')
      .select('*')
      .eq('negocio_id', negocio.id)
      .order('nombre');
    setProveedores(data || []);
    setCargando(false);
  }

  function abrirAlta() {
    setEditando(null);
    setNombre('');
    setContacto('');
    setTelefono('');
    setEmail('');
    setNotas('');
    setError(null);
    setVistaForm(true);
  }

  function abrirEdicion(p) {
    setEditando(p);
    setNombre(p.nombre);
    setContacto(p.contacto || '');
    setTelefono(p.telefono || '');
    setEmail(p.email || '');
    setNotas(p.notas || '');
    setError(null);
    setVistaForm(true);
  }

  async function guardar(e) {
    e.preventDefault();
    if (!nombre.trim()) {
      setError('Falta el nombre.');
      return;
    }
    setGuardando(true);
    setError(null);

    const payload = {
      nombre: nombre.trim(),
      contacto: contacto.trim() || null,
      telefono: telefono.trim() || null,
      email: email.trim() || null,
      notas: notas.trim() || null,
    };

    const { error: err } = editando
      ? await supabase.from('proveedores').update(payload).eq('id', editando.id)
      : await supabase.from('proveedores').insert({ ...payload, negocio_id: negocio.id });

    setGuardando(false);
    if (err) {
      setError('No se pudo guardar. Probá de nuevo.');
      return;
    }
    setVistaForm(false);
    cargar();
  }

  async function toggleActivo(p) {
    await supabase.from('proveedores').update({ activo: !p.activo }).eq('id', p.id);
    cargar();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-xl text-ink">Proveedores</p>
        <button
          onClick={abrirAlta}
          className="flex items-center gap-1 rounded-full bg-brand px-3 py-2 text-xs font-medium text-ink active:scale-[0.98]"
        >
          <Plus size={16} /> Agregar
        </button>
      </div>

      {cargando && <p className="pt-4 text-center text-sm text-muted">Cargando…</p>}

      {!cargando && proveedores.length === 0 && (
        <p className="pt-4 text-center text-sm text-muted">
          Todavía no cargaste ningún proveedor. Con "Agregar" sumás el primero.
        </p>
      )}

      <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Contacto</th>
              <th className="px-4 py-3">Teléfono</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {proveedores.map((p) => (
              <tr key={p.id} onClick={() => abrirEdicion(p)} className={`cursor-pointer hover:bg-surface2 ${!p.activo ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 font-medium text-ink">{p.nombre}</td>
                <td className="px-4 py-3 text-muted">{p.contacto || '—'}</td>
                <td className="px-4 py-3 text-muted">
                  {p.telefono ? (
                    <a
                      href={`https://wa.me/${p.telefono}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 text-accent"
                    >
                      <Phone size={12} /> {p.telefono}
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{p.activo ? 'Activo' : 'Inactivo'}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleActivo(p);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                      p.activo ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
                    }`}
                  >
                    {p.activo ? 'Dar de baja' : 'Reactivar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {vistaForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setVistaForm(false)}
        >
          <div className="w-full max-w-md rounded-2xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-display text-lg text-ink">{editando ? 'Editar proveedor' : 'Nuevo proveedor'}</p>
              <button onClick={() => setVistaForm(false)} className="shrink-0 text-muted">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={guardar} className="mt-3 space-y-2.5">
              <input
                autoFocus
                placeholder="Nombre del proveedor"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="w-full rounded-xl border border-line bg-base px-4 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                placeholder="Persona de contacto (opcional)"
                value={contacto}
                onChange={(e) => setContacto(e.target.value)}
                className="w-full rounded-xl border border-line bg-base px-4 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                placeholder="Teléfono (opcional)"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                className="w-full rounded-xl border border-line bg-base px-4 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                type="email"
                placeholder="Email (opcional)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-line bg-base px-4 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
              <textarea
                placeholder="Notas (opcional)"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-line bg-base px-4 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />

              {error && <p className="text-sm text-danger">{error}</p>}

              <button
                type="submit"
                disabled={guardando}
                className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink disabled:opacity-60"
              >
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
