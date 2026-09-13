-- ============================================================
-- AS ADMIN — Migración 017: detalle y comprobante en movimientos financieros
-- Correr DESPUÉS de 016_comprobantes_pago.sql
--
-- Hasta ahora un gasto/ingreso manual cargado en Finanzas era solo un
-- número + una nota de texto, sin respaldo ni trazabilidad — bastante
-- lejos de lo que necesita incluso un negocio chico para confiar en sus
-- propios números, y ya insuficiente para uno mediano con varios
-- empleados cargando movimientos. Este cambio agrega:
--   1. Comprobante adjunto (misma idea que ya tienen las ventas)
--   2. Quién lo cargó (importante en cuanto hay más de una persona
--      tocando la caja — antes no quedaba registro de nada)
-- ============================================================

alter table movimientos_financieros add column if not exists comprobante_url text;

comment on column movimientos_financieros.comprobante_url is
  'Ruta en el bucket comprobantes-pago (mismo bucket privado que ventas.comprobante_url, con el prefijo mov- para no chocar con los ids de venta). Respaldo/auditoría, no confirma nada por sí solo.';

-- No referencia a 'usuarios' porque el dueño no tiene fila ahí (ver
-- comentario en 011_usuarios_y_roles.sql) — se guarda el auth.uid() tal
-- cual, igual que ventas.anulada_por, y se resuelve el nombre en el
-- panel mirando negocios.auth_user_id o usuarios.auth_user_id.
-- El default captura quién estaba autenticado al momento del insert —
-- funciona tanto para una carga manual como para el trigger automático
-- de una venta/turno, porque corre en la misma transacción de quien
-- hizo la acción original. Con el bot (service_role) queda null, que es
-- lo correcto: nadie humano lo cargó.
alter table movimientos_financieros add column if not exists registrado_por uuid default auth.uid();

comment on column movimientos_financieros.registrado_por is
  'auth.uid() de quien registró el movimiento (dueño o empleado). Null si lo generó el bot u otro proceso sin sesión de usuario.';
