import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Download, X, AlertTriangle, Check, Layers } from 'lucide-react';
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
  proveedor: 'proveedor',
  sku: 'sku',
  codigo: 'sku',
  marca: 'marca',
  descripcion: 'descripcion',
  codigo_barras: 'codigo_barras',
  barcode: 'codigo_barras',
  ean: 'codigo_barras',
  // Variantes — cada fila con talle y/o color se agrupa con las demás
  // filas del mismo "nombre" como variantes de un solo producto.
  talle: 'talle',
  variante_talle: 'talle',
  atributo1: 'talle',
  size: 'talle',
  color: 'color',
  variante_color: 'color',
  atributo2: 'color',
  precio_variante: 'precio_override',
  precio_override: 'precio_override',
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
  let crudo = texto.toString().trim();
  if (crudo.startsWith('-')) return null; // un precio/stock negativo no es válido
  // "150.000,00" o "1500,5": un punto/coma seguido de 1 o 2 dígitos al final
  // son decimales (Excel/Sheets los exportan así) — se descartan. Con 3
  // dígitos ("150.000") sigue siendo separador de miles.
  crudo = crudo.replace(/[.,]\d{1,2}$/, '');
  const limpio = crudo.replace(/[^\d]/g, '');
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

/** .xlsx (o .xls) → mismo formato "array de filas" que parseCSV, así el
 * resto del código no necesita saber de qué tipo de archivo vino. */
function parseXLSX(arrayBuffer) {
  const libro = XLSX.read(arrayBuffer, { type: 'array' });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: '' });
  return filas
    .map((fila) => fila.map((c) => (c === null || c === undefined ? '' : String(c))))
    .filter((fila) => fila.some((x) => x.trim() !== ''));
}

function descargarPlantilla() {
  const encabezados = [
    'nombre', 'precio', 'costo', 'stock', 'stock_minimo', 'categoria', 'proveedor',
    'sku', 'codigo_barras', 'marca', 'talle', 'color',
  ];
  const filas = [
    ['Proteína vainilla 1kg', '210000', '140000', '10', '3', 'Suplementos', '', 'PROT-VAI-1K', '7840001000011', '', '', ''],
    // Mismo "nombre" en más de una fila = variantes de un solo producto
    // (el precio/costo/categoría se toman de la primera fila que los
    // tenga; talle/color/stock son propios de cada fila).
    ['Remera básica', '85000', '45000', '5', '2', 'Ropa', '', '', '', '', 'M', 'Blanco'],
    ['Remera básica', '85000', '45000', '3', '2', 'Ropa', '', '', '', '', 'L', 'Blanco'],
  ];
  // El BOM al principio es lo que hace que Excel abra bien las tildes
  // en vez de mostrar "Proteína" como "ProteÃna".
  const contenido = '﻿' + [encabezados, ...filas].map((f) => f.join(';')).join('\r\n');
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
  const [grupos, setGrupos] = useState(null); // productos ya agrupados, validados y cruzados contra lo existente
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [procesandoArchivo, setProcesandoArchivo] = useState(false);
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
    setProcesandoArchivo(true);

    try {
      const esExcel = /\.xlsx?$/i.test(archivo.name);
      const tabla = esExcel ? parseXLSX(await archivo.arrayBuffer()) : parseCSV(await archivo.text());

      if (tabla.length < 2) {
        setError('El archivo no tiene filas de datos (solo encabezado, o está vacío).');
        setGrupos(null);
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
        setGrupos(null);
        return;
      }

      const leer = (fila, campo) => {
        const i = indice[campo];
        return i === undefined ? '' : (fila[i] || '').trim();
      };

      // Se agrupa por nombre normalizado: varias filas con el mismo
      // nombre son variantes (talle/color) de un solo producto — la
      // planilla no necesita ninguna columna extra para indicar eso,
      // alcanza con repetir el nombre.
      const gruposPorClave = new Map();
      tabla.slice(1).forEach((fila, i) => {
        const nombre = leer(fila, 'nombre');
        const clave = nombre.toLowerCase();
        if (!gruposPorClave.has(clave)) {
          gruposPorClave.set(clave, {
            nombre,
            _filas: [], // número de fila real del archivo, para los mensajes de error
            precio: null,
            costo: null,
            categoria: null,
            proveedor: null,
            marca: null,
            descripcion: null,
            sku: null,
            codigo_barras: null,
            stock_minimo: null,
            stock: null, // solo si termina siendo un producto sin variantes
            variantes: [],
          });
        }
        const g = gruposPorClave.get(clave);
        g._filas.push(i + 2); // +2: fila 1 es encabezado, la gente cuenta desde 1

        // Los campos "de producto" se completan con la primera fila del
        // grupo que los traiga — así no hace falta repetir precio,
        // categoría, etc. en cada fila de variante.
        if (g.precio === null) g.precio = numeroLimpio(leer(fila, 'precio'));
        if (g.costo === null) g.costo = numeroLimpio(leer(fila, 'costo'));
        if (!g.categoria) g.categoria = leer(fila, 'categoria') || null;
        if (!g.proveedor) g.proveedor = leer(fila, 'proveedor') || null;
        if (!g.marca) g.marca = leer(fila, 'marca') || null;
        if (!g.descripcion) g.descripcion = leer(fila, 'descripcion') || null;
        if (g.stock_minimo === null) g.stock_minimo = numeroLimpio(leer(fila, 'stock_minimo'));

        const talle = leer(fila, 'talle');
        const color = leer(fila, 'color');

        if (talle || color) {
          g.variantes.push({
            talle: talle || null,
            color: color || null,
            stock: numeroLimpio(leer(fila, 'stock')) ?? 0,
            sku: leer(fila, 'sku') || null,
            codigo_barras: leer(fila, 'codigo_barras') || null,
            precio_override: numeroLimpio(leer(fila, 'precio_override')),
          });
        } else {
          // Fila "simple" dentro de un grupo: si el grupo ya tiene
          // variantes, esta fila se ignora como producto (ya se leyeron
          // sus campos de producto arriba) — no tiene sentido un stock
          // "general" mezclado con variantes puntuales.
          if (g.sku === null) g.sku = leer(fila, 'sku') || null;
          if (g.codigo_barras === null) g.codigo_barras = leer(fila, 'codigo_barras') || null;
          if (g.stock === null) g.stock = numeroLimpio(leer(fila, 'stock'));
        }
      });

      const grupos = Array.from(gruposPorClave.values()).map((g) => {
        const tieneVariantes = g.variantes.length > 0;
        const errores = [];
        if (!g.nombre) errores.push('sin nombre');
        if (!g.precio || g.precio <= 0) errores.push('sin precio válido');
        if (tieneVariantes && g.variantes.some((v) => !v.talle && !v.color)) {
          errores.push('alguna variante no tiene talle ni color');
        }
        return { ...g, tieneVariantes, stock: tieneVariantes ? null : g.stock ?? 0, errores };
      });

      // Cruce contra lo que ya existe: por SKU/código de barras primero
      // (es el identificador más confiable), y si no hay, por nombre —
      // así reimportar la misma planilla actualiza en vez de duplicar.
      const { data: existentes } = await supabase
        .from('productos')
        .select('id, nombre, sku, codigo_barras, tiene_variantes, variantes_producto(id, sku, codigo_barras, atributo1_valor, atributo2_valor, activo)')
        .eq('negocio_id', negocio.id);

      const porNombre = new Map();
      const porSku = new Map();
      const porBarcode = new Map();
      for (const p of existentes || []) {
        porNombre.set(p.nombre.toLowerCase(), p);
        if (p.sku) porSku.set(p.sku, p);
        if (p.codigo_barras) porBarcode.set(p.codigo_barras, p);
      }

      const gruposCruzados = grupos.map((g) => {
        if (g.errores.length > 0) return g;

        const existente =
          (g.sku && porSku.get(g.sku)) || (g.codigo_barras && porBarcode.get(g.codigo_barras)) || porNombre.get(g.nombre.toLowerCase());

        if (!existente) return { ...g, productoExistenteId: null };

        if (existente.tiene_variantes !== g.tieneVariantes) {
          return {
            ...g,
            productoExistenteId: null,
            errores: [
              `ya existe un producto "${g.nombre}" ${existente.tiene_variantes ? 'con variantes' : 'sin variantes'} — no se puede cambiar de tipo importando`,
            ],
          };
        }

        if (!g.tieneVariantes) {
          return { ...g, productoExistenteId: existente.id };
        }

        // Variantes: se cruza cada una por su propio SKU/código de
        // barras, y si no tiene, por la combinación talle+color.
        const variantesExistentes = (existente.variantes_producto || []).filter((v) => v.activo);
        const vPorSku = new Map();
        const vPorBarcode = new Map();
        const vPorCombo = new Map();
        for (const v of variantesExistentes) {
          if (v.sku) vPorSku.set(v.sku, v.id);
          if (v.codigo_barras) vPorBarcode.set(v.codigo_barras, v.id);
          vPorCombo.set(`${v.atributo1_valor || ''}::${v.atributo2_valor || ''}`, v.id);
        }

        const variantesCruzadas = g.variantes.map((v) => ({
          ...v,
          varianteExistenteId:
            (v.sku && vPorSku.get(v.sku)) ||
            (v.codigo_barras && vPorBarcode.get(v.codigo_barras)) ||
            vPorCombo.get(`${v.talle || ''}::${v.color || ''}`) ||
            null,
        }));

        return { ...g, productoExistenteId: existente.id, variantes: variantesCruzadas };
      });

      setGrupos(gruposCruzados);
    } catch (err) {
      console.error(err);
      setError('No se pudo leer el archivo. Revisá que sea un .csv o .xlsx válido.');
      setGrupos(null);
    } finally {
      setProcesandoArchivo(false);
    }
  }

  const validos = grupos?.filter((g) => g.errores.length === 0) || [];
  const invalidos = grupos?.filter((g) => g.errores.length > 0) || [];
  const nuevos = validos.filter((g) => !g.productoExistenteId);
  const actualizados = validos.filter((g) => g.productoExistenteId);

  async function confirmarImportacion() {
    if (validos.length === 0 || importandoRef.current) return;
    importandoRef.current = true;
    setImportando(true);
    setError(null);

    try {
      // Categorías y proveedores: se resuelven por nombre, y los que no
      // existan se crean en el momento — así el dueño no tiene que
      // pre-cargarlos antes de poder importar.
      async function resolverPorNombre(tabla, nombres) {
        const mapa = {};
        if (!nombres.length) return mapa;
        const { data: existentes } = await supabase.from(tabla).select('id, nombre').eq('negocio_id', negocio.id).in('nombre', nombres);
        (existentes || []).forEach((r) => (mapa[r.nombre] = r.id));
        const faltantes = nombres.filter((n) => !mapa[n]);
        if (faltantes.length) {
          const { data: creados, error: errCrear } = await supabase
            .from(tabla)
            .insert(faltantes.map((nombre) => ({ negocio_id: negocio.id, nombre })))
            .select('id, nombre');
          if (errCrear) throw errCrear;
          (creados || []).forEach((r) => (mapa[r.nombre] = r.id));
        }
        return mapa;
      }

      const mapaCategorias = await resolverPorNombre('categorias', [...new Set(validos.map((g) => g.categoria).filter(Boolean))]);
      const mapaProveedores = await resolverPorNombre('proveedores', [...new Set(validos.map((g) => g.proveedor).filter(Boolean))]);

      let contadorNuevos = 0;
      let contadorActualizados = 0;

      for (const g of validos) {
        const camposComunes = {
          categoria_id: g.categoria ? mapaCategorias[g.categoria] : undefined,
          proveedor_id: g.proveedor ? mapaProveedores[g.proveedor] : undefined,
          marca: g.marca ?? undefined,
          descripcion: g.descripcion ?? undefined,
          precio: g.precio ?? undefined,
          costo: g.costo ?? undefined,
          stock_minimo: g.stock_minimo ?? undefined,
        };
        // undefined se filtra antes de mandar — así un update parcial
        // nunca pisa con null un dato que la planilla no traía.
        const limpiar = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

        if (!g.tieneVariantes) {
          if (g.productoExistenteId) {
            const { error: errUpd } = await supabase
              .from('productos')
              .update(limpiar({ ...camposComunes, sku: g.sku ?? undefined, codigo_barras: g.codigo_barras ?? undefined, stock: g.stock ?? undefined }))
              .eq('id', g.productoExistenteId);
            if (errUpd) throw errUpd;
            contadorActualizados++;
          } else {
            const { error: errIns } = await supabase.from('productos').insert({
              negocio_id: negocio.id,
              nombre: g.nombre,
              precio: g.precio,
              costo: g.costo,
              categoria_id: g.categoria ? mapaCategorias[g.categoria] : null,
              proveedor_id: g.proveedor ? mapaProveedores[g.proveedor] : null,
              marca: g.marca,
              descripcion: g.descripcion,
              sku: g.sku,
              codigo_barras: g.codigo_barras,
              stock: g.stock ?? 0,
              stock_minimo: g.stock_minimo ?? 0,
              tiene_variantes: false,
              activo: true,
            });
            if (errIns) throw errIns;
            contadorNuevos++;
          }
          continue;
        }

        // Producto con variantes
        let productoId = g.productoExistenteId;
        if (productoId) {
          const { error: errUpd } = await supabase.from('productos').update(limpiar(camposComunes)).eq('id', productoId);
          if (errUpd) throw errUpd;
          contadorActualizados++;
        } else {
          const { data: nuevo, error: errIns } = await supabase
            .from('productos')
            .insert({
              negocio_id: negocio.id,
              nombre: g.nombre,
              precio: g.precio,
              costo: g.costo,
              categoria_id: g.categoria ? mapaCategorias[g.categoria] : null,
              proveedor_id: g.proveedor ? mapaProveedores[g.proveedor] : null,
              marca: g.marca,
              descripcion: g.descripcion,
              stock: 0,
              stock_minimo: g.stock_minimo ?? 0,
              tiene_variantes: true,
              activo: true,
            })
            .select('id')
            .single();
          if (errIns) throw errIns;
          productoId = nuevo.id;
          contadorNuevos++;
        }

        for (const v of g.variantes) {
          if (v.varianteExistenteId) {
            const { error: errUpdV } = await supabase
              .from('variantes_producto')
              .update({ stock: v.stock, precio_override: v.precio_override })
              .eq('id', v.varianteExistenteId);
            if (errUpdV) throw errUpdV;
          } else {
            const { error: errInsV } = await supabase.from('variantes_producto').insert({
              producto_id: productoId,
              negocio_id: negocio.id,
              atributo1_nombre: v.talle ? 'Talle' : null,
              atributo1_valor: v.talle,
              atributo2_nombre: v.color ? 'Color' : null,
              atributo2_valor: v.color,
              sku: v.sku,
              codigo_barras: v.codigo_barras,
              stock: v.stock,
              precio_override: v.precio_override,
              activo: true,
            });
            if (errInsV) throw errInsV;
          }
        }
      }

      setResultado({ nuevos: contadorNuevos, actualizados: contadorActualizados, conError: invalidos.length });
      setGrupos(null);
    } catch (err) {
      console.error(err);
      const mensaje =
        err.message?.includes('duplicate') || err.code === '23505'
          ? 'Alguno de los SKU o códigos de barras ya existe en otro producto de tu catálogo. Revisá el archivo y probá de nuevo.'
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
            {resultado.nuevos} producto{resultado.nuevos === 1 ? '' : 's'} nuevo{resultado.nuevos === 1 ? '' : 's'}
            {resultado.actualizados > 0 && `, ${resultado.actualizados} actualizado${resultado.actualizados === 1 ? '' : 's'}`}
          </p>
          {resultado.conError > 0 && (
            <p className="text-xs text-amber">
              {resultado.conError} producto{resultado.conError === 1 ? '' : 's'} no se {resultado.conError === 1 ? 'importó' : 'importaron'} por tener errores.
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

      {!grupos && (
        <>
          <div className="rounded-2xl bg-surface p-4 shadow-card">
            <p className="text-sm text-ink">Subí un archivo Excel (.xlsx) o CSV con tu catálogo.</p>
            <p className="mt-1 text-xs text-muted">
              Necesita como mínimo las columnas <span className="font-mono">nombre</span> y{' '}
              <span className="font-mono">precio</span>. Si un producto tiene variantes (talle/color), repetí el mismo
              nombre en una fila por cada variante. Si el nombre, SKU o código de barras ya existe en tu catálogo, se
              actualiza en vez de crear uno nuevo.
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
            <span className="text-sm text-ink">{procesandoArchivo ? 'Leyendo…' : 'Elegir archivo .xlsx o .csv'}</span>
            {nombreArchivo && <span className="text-xs text-muted">{nombreArchivo}</span>}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onElegirArchivo}
              disabled={procesandoArchivo}
              className="hidden"
            />
          </label>

          {error && (
            <p className="flex items-start gap-2 rounded-xl bg-danger-soft p-3 text-xs text-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
        </>
      )}

      {grupos && (
        <>
          <div className="flex gap-3">
            <div className="flex-1 rounded-xl bg-surface p-3 text-center shadow-card">
              <p className="font-display text-xl font-semibold text-accent">{nuevos.length}</p>
              <p className="text-xs text-muted">Nuevos</p>
            </div>
            <div className="flex-1 rounded-xl bg-surface p-3 text-center shadow-card">
              <p className="font-display text-xl font-semibold text-ink">{actualizados.length}</p>
              <p className="text-xs text-muted">Se actualizan</p>
            </div>
            {invalidos.length > 0 && (
              <div className="flex-1 rounded-xl bg-surface p-3 text-center shadow-card">
                <p className="font-display text-xl font-semibold text-danger">{invalidos.length}</p>
                <p className="text-xs text-muted">Con error</p>
              </div>
            )}
          </div>

          {error && <p className="rounded-xl bg-danger-soft p-3 text-xs text-danger">{error}</p>}

          <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl bg-surface p-2 shadow-card">
            {grupos.map((g) => (
              <div
                key={g.nombre + g._filas[0]}
                className={`rounded-lg px-2.5 py-2 text-sm ${g.errores.length ? 'bg-danger-soft' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-ink">
                      {g.tieneVariantes && <Layers size={12} className="shrink-0 text-muted" />}
                      {g.nombre || <span className="text-muted">(sin nombre)</span>}
                    </p>
                    {g.errores.length > 0 ? (
                      <p className="text-xs text-danger">
                        Fila{g._filas.length > 1 ? 's' : ''} {g._filas.join(', ')}: {g.errores.join(', ')}
                      </p>
                    ) : (
                      <p className="text-xs text-muted">
                        {g.tieneVariantes ? `${g.variantes.length} variante${g.variantes.length === 1 ? '' : 's'}` : null}
                        {g.tieneVariantes && ' · '}
                        {g.productoExistenteId ? 'se actualiza' : 'nuevo'}
                      </p>
                    )}
                  </div>
                  {!g.errores.length && (
                    <span className="shrink-0 font-mono text-xs text-muted">Gs. {g.precio.toLocaleString('es-PY')}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => {
                setGrupos(null);
                setNombreArchivo('');
                if (inputRef.current) inputRef.current.value = '';
              }}
              className="flex-1 rounded-xl border border-line py-3 text-sm text-muted"
            >
              Elegir otro archivo
            </button>
            <button
              onClick={confirmarImportacion}
              disabled={importando || validos.length === 0}
              className="flex-1 rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink disabled:opacity-60"
            >
              {importando ? 'Importando…' : `Importar ${validos.length}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
