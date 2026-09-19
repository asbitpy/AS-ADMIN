// Permisos por excepción: dueño y gerente ya tienen acceso a todo esto;
// un cajero/vendedor/profesional lo recibe solo si se lo marcan en
// Equipo → su ficha → Permisos especiales (usuarios.permisos_extra).
//
// Ojo: salvo 'anular_ventas' (que además lo exige la base, migración
// 029), estos permisos controlan qué pantallas se ven en el panel — no
// son una barrera a nivel de base de datos.
export const PERMISOS = [
  { id: 'ver_finanzas', label: 'Ver Finanzas', desc: 'Ingresos, egresos, gastos fijos y reportes del negocio.' },
  { id: 'ver_caja', label: 'Ver Caja e Inventario', desc: 'Historial de cajas y movimientos de stock (escritorio).' },
  { id: 'gestionar_compras', label: 'Gestionar Proveedores y Compras', desc: 'Cargar proveedores y órdenes de compra (escritorio).' },
  { id: 'configurar', label: 'Entrar a Configuración', desc: 'Horarios, servicios, datos del negocio y apariencia.' },
  { id: 'anular_ventas', label: 'Anular ventas', desc: 'Por default solo dueño y gerente pueden anular una venta.' },
];

export function tienePermiso({ esDueno, rol, permisosExtra }, permiso) {
  if (esDueno || rol === 'dueno' || rol === 'gerente') return true;
  return (permisosExtra || []).includes(permiso);
}
