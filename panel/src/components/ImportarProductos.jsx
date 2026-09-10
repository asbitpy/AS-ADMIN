import { useRef, useState } from 'react';
import { Upload, Download, X, AlertTriangle, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// Encabezados posibles → campo real, todo normalizado a minúsculas sin
// tildes. Así "Código de barras", "codigo_barras" y "CÓDIGO BARRAS"
// apuntan al mismo lugar sin obligar al dueño a usar un nombre exacto.
const MAPA_ENCABEZADOS = {
  nombre: 'nombre',
  producto: 'nombre',
  precio: 'precio',
  precio_venta: 'precio',
  pvp: 'precio',
  costo: 'costo',
  precio_costo: 'costo',
  stock: 'stock',
  cantidad: 'stock',
  stock_inicial: 'stock',
  stock_minimo: 'stock_minimo',
  minimo: 'stock_minimo',
  categoria: 'categoria',
  sku: 'sku',
  codigo: 'sku',
  marca: 'marca',
  descripcion: 'descripcion',
  codigo_barras: 'codigo_barras',
  barcode: 'codigo_barras',
  ean: 'codigo_barras',
};

function normalizar(texto) {
  return (texto || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca los acentos que normalize separó
    .replace(/\s+/g, '_');
}

/** Convierte "150.000", "150000" o "Gs. 150.000" en el número 150000.
 * Los montos acá son guaraníes sin decimales, así que cualquier punto o
 * separador es de miles, nunca decimal — se puede tirar todo lo que no
 * sea dígito sin perder información. */
function numeroLimpio(texto) {
  if (texto === undefined || texto === null || texto === '') return null;
  const limpio = texto.toString().replace(/[^\d]/g, '');
  return limpio ? Number(limpio) : null;
}

/** Parser de CSV chico pero correcto: entiende comillas, separadores
 * escapados adentro de un campo, y detecta solo si el archivo usa ','
 * o ';' (Excel en español suele exportar con ';'). No es para
 * cualquier CSV del mundo — es para el que exporta Excel/Sheets, que
 * es el 99% de los casos reales acá. */
function parseCSV(texto) {
  const primeraLinea = texto.split(/\r?\n/)[0] || '';
  const sep = (primeraLinea.match(/;/g) || []).length > (primeraLinea.match(/,/g) || []).length ? ';' : ',';

  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else entreComillas = false;
      } else campo += c;
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === sep) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo);
      campo = '';
      if (fila.some((x) => x.trim() !== '')) filas.push(fila);
      fila = [];
    } else {
      campo += c;
    }
  }
  if (campo !== '' || fila.length) {
    fila.push(campo);
    if (fila.some((x) => x.trim() !== '')) filas.push(fila);
  }
  return filas;
}

function descargarPlantilla() {
  const encabezados = ['nombre', 'precio', 'costo', 'stock', 'stock_minimo', 'categoria', 'sku', 'codigo_barras', 'marca'];
  const ejemplo = ['Proteína vainilla 1kg', '210000', '140000', '10', '3', 'Suplementos', 'PROT-VAI-1K', '7840001000011', ''];
  // El BOM al principio es lo que hace que Excel abra bien las tildes
  // en vez de mostrar "Proteína" como "ProteÃna".
  const contenido = '﻿' + [encabezados, ejemplo].map((f) => f.join(';')).join('\r\n');
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla_productos_as_admin.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportarProductos({ onCancelar, onImportado }) {
  const { negocio } = useAuth();
  const inputRef = useRef(null);
  const [filas, setFilas] = useState(null); // filas ya validadas, listas para revisar
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  // Mismo motivo que en ProductoForm y en el cobro del POS: 'importando'
  // no alcanza a desactivar el botón antes de un segundo clic.
  const importandoRef = useRef(false);

  async function onElegirArchivo(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setError(null);
    setResultado(null);
    setNombreArchivo(archivo.name);

    const texto = await archivo.text();
    const tabla = parseCSV(texto);

    if (tabla.length < 2) {
      setError('El archivo no tiene filas de datos (solo encabezado, o está vacío).');
      setFilas(null);
      return;
    }

    const encabezados = tabla[0].map(normalizar);
    const indice = {};
    encabezados.forEach((h, i) => {
      const campo = MAPA_ENCABEZADOS[h];
      if (campo && !(campo in indice)) indice[campo] = i;
    });

    if (!('nombre' in indice) || !('precio' in indice)) {
      setError(
        'No encontré las columnas "nombre" y "precio" en el archivo. Revisá que la primera fila sea el encabezado, o descargá la plantilla de acá abajo.'
      );
      setFilas(null);
      return;
    }

    const leer = (fila, campo) => {
      const i = indice[campo];
      return i === undefined ? '' : (fila[i] || '').trim();
    };

    const procesadas = tabla.slice(1).map((fila, i) => {
      const nombre = leer(fila, 'nombre');
      const precio = numeroLimpio(leer(fila, 'precio'));
      const errores = [];
      if (!nombre) errores.push('sin nombre');
      if (!precio || precio <= 0) errores.push('sin precio válido');

      return {
        _fila: i + 2, // +2: la fila 1 es el encabezado, y la gente cuenta desde 1
        nombre,
        precio,
        costo: numeroLimpio(leer(fila, 'costo')),
        stock: numeroLimpio(leer(fila, 'stock')) ?? 0,
        stock_minimo: numeroLimpio(leer(fila, 'stock_minimo')) ?? 0,
        categoria: leer(fila, 'categoria') || null,
        sku: leer(fila, 'sku') || null,
        codigo_barras: leer(fila, 'codigo_barras') || null,
        marca: leer(fila, 'marca') || null,
        descripcion: leer(fila, 'descripcion') || null,
        errores,
      };
    });

    setFilas(procesadas);
  }

  const validas = filas?.filter((f) => f.errores.length === 0) || [];
  const invalidas = filas?.filter((f) => f.errores.length > 0) || [];

  async function confirmarImportacion() {
    if (validas.length === 0 || importandoRef.current) return;
    importandoRef.current = true;
    setImportando(true);
    setError(null);

    try {
      // Categorías: se resuelven por nombre. Las que no existan se crean
      // en el momento — así el dueño no tiene que pre-cargarlas a mano
      // antes de poder importar.
      const nombresCategorias = [...new Set(validas.map((f) => f.categoria).filter(Boolean))];
      const mapaCategorias = {};

      if (nombresCategorias.length) {
        const { data: existentes } = await supabase
          .from('categorias')
          .select('id, nombre')
          .eq('negocio_id', negocio.id)
          .in('nombre', nombresCategorias);

        (existentes || []).forEach((c) => (mapaCategorias[c.nombre] = c.id));

        const faltantes = nombresCategorias.filter((n) => !mapaCategorias[n]);
        if (faltantes.length) {
          const { data: creadas, error: errCat } = await supabase
            .from('categorias')
            .insert(faltantes.map((nombre) => ({ negocio_id: negocio.id, nombre })))
            .select('id, nombre');
          if (errCat) throw errCat;
          (creadas || []).forEach((c) => (mapaCategorias[c.nombre] = c.id));
        }
      }

      const payload = validas.map((f) => ({
        negocio_id: negocio.id,
        nombre: f.nombre,
        precio: f.precio,
        costo: f.costo,
        stock: f.stock,
        stock_minimo: f.stock_minimo,
        categoria_id: f.categoria ? mapaCategorias[f.categoria] || null : null,
        sku: f.sku,
        codigo_barras: f.codigo_barras,
        marca: f.marca,
        descripcion: f.descripcion,
        tiene_variantes: false,
        activo: true,
      }));

      const { error: errInsert } = await supabase.from('productos').insert(payload);
      if (errInsert) throw errInsert;

      setResultado({ importados: payload.length, conError: invalidas.length });
      setFilas(null);
    } catch (err) {
      console.error(err);
      const mensaje = err.message?.includes('duplicate') || err.code === '23505'
        ? 'Alguno de los SKU o códigos de barras ya existe en tu catálogo. Sacá esa fila del archivo (o el dato duplicado) y probá de nuevo.'
        : 'No se pudo importar. Revisá el archivo y probá de nuevo.';
      setError(mensaje);
    } finally {
      importandoRef.current = false;
      setImportando(false);
    }
  }

  if (resultado) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface p-8 text-center shadow-card">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
            <Check size={26} className="text-accent" />
          </div>
          <p className="font-display text-lg text-ink">
            {resultado.importados} producto{resultado.importados === 1 ? '' : 's'} importado
            {resultado.importados === 1 ? '' : 's'}
          </p>
          {resultado.conError > 0 && (
            <p className="text-xs text-amber">
              {resultado.conError} fila{resultado.conError === 1 ? '' : 's'} no se {resultado.conError === 1 ? 'importó' : 'importaron'} por tener errores.
            </p>
          )}
        </div>
        <button
          onClick={onImportado}
          className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink active:scale-[0.98]"
        >
          Ver catálogo
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">Importar productos</h2>
        <button onClick={onCancelar} className="rounded-full p-1.5 text-muted">
          <X size={20} />
        </button>
      </div>

      {!filas && (
        <>
          <div className="rounded-2xl bg-surface p-4 shadow-card">
            <p className="text-sm text-ink">Subí un archivo CSV con tu catálogo.</p>
            <p className="mt-1 text-xs text-muted">
              De Excel o Google Sheets: <span className="font-medium">Archivo → Guardar/Descargar como → CSV</span>.
              Necesita como mínimo las columnas <span className="font-mono">nombre</span> y{' '}
              <span className="font-mono">precio</span>.
            </p>

            <button
              onClick={descargarPlantilla}
              className="mt-3 flex items-center gap-1.5 text-xs font-medium text-accent"
            >
              <Download size={14} /> Descargar plantilla de ejemplo
            </button>
          </div>

          <label className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface py-10 text-center">
            <Upload size={22} className="text-muted" />
            <span className="text-sm text-ink">Elegir archivo CSV</span>
            {nombreArchivo && <span className="text-xs text-muted">{nombreArchivo}</span>}
            <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={onElegirArchivo} className="hidden" />
          </label>

          {error && (
            <p className="flex items-start gap-2 rounded-xl bg-danger-soft p-3 text-xs text-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
        </>
      )}

      {filas && (
        <>
          <div className="flex gap-3">
            <div className="flex-1 rounded-xl bg-surface p-3 text-center shadow-card">
              <p className="font-display text-xl font-semibold text-accent">{validas.length}</p>
              <p className="text-xs text-muted">Listos para importar</p>
            </div>
            {invalidas.length > 0 && (
              <div className="flex-1 rounded-xl bg-surface p-3 text-center shadow-card">
                <p className="font-display text-xl font-semibold text-danger">{invalidas.length}</p>
                <p className="text-xs text-muted">Con error</p>
              </div>
            )}
          </div>

          {error && <p className="rounded-xl bg-danger-soft p-3 text-xs text-danger">{error}</p>}

          <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl bg-surface p-2 shadow-card">
            {filas.map((f) => (
              <div
                key={f._fila}
                className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-sm ${
                  f.errores.length ? 'bg-danger-soft' : ''
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-ink">
                    {f.nombre || <span className="text-muted">(sin nombre)</span>}
                  </p>
                  {f.errores.length > 0 && (
                    <p className="text-xs text-danger">Fila {f._fila}: {f.errores.join(', ')}</p>
                  )}
                </div>
                {!f.errores.length && (
                  <span className="shrink-0 font-mono text-xs text-muted">
                    Gs. {f.precio.toLocaleString('es-PY')}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => {
                setFilas(null);
                setNombreArchivo('');
                if (inputRef.current) inputRef.current.value = '';
              }}
              className="flex-1 rounded-xl border border-line py-3 text-sm text-muted"
            >
              Elegir otro archivo
            </button>
            <button
              onClick={confirmarImportacion}
              disabled={importando || validas.length === 0}
              className="flex-1 rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink disabled:opacity-60"
            >
              {importando ? 'Importando…' : `Importar ${validas.length}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
