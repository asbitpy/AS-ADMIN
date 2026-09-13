-- ============================================================
-- AS ADMIN — Migración 018: gastos fijos mensuales
-- Correr DESPUÉS de 017_detalle_movimientos.sql
--
-- Alquiler, luz, agua, sueldos fijos: se definen una sola vez (nombre,
-- categoría, monto estimado, día del mes) y Finanzas recuerda
-- confirmarlos cuando corresponde — pero NUNCA los carga solo. La
-- razón: un servicio como la luz no siempre sale el mismo monto exacto,
-- y un pago se puede atrasar unos días; si el sistema lo diera por
-- pagado solo, podría mostrar plata como gastada que en realidad
-- todavía no salió. Mismo principio que ya aplicamos con los
-- comprobantes de pago: nada de plata se mueve sin que una persona lo
-- confirme.
-- ============================================================

create table if not exists gastos_fijos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  nombre text not null,
  categoria text not null default 'gasto',
  monto_estimado numeric(12,0) not null,
  dia_mes int not null check (dia_mes between 1 and 31),
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create index idx_gastos_fijos_negocio on gastos_fijos(negocio_id) where activo;

alter table gastos_fijos enable row level security;
drop policy if exists "equipo ve sus gastos fijos" on gastos_fijos;
create policy "equipo ve sus gastos fijos" on gastos_fijos
  for all using (negocio_id in (select fn_negocios_accesibles()));

-- Vincula el movimiento real (ya confirmado por una persona) con la
-- definición del gasto fijo que lo originó — así el panel sabe que
-- este mes ya se pagó y no vuelve a recordarlo.
alter table movimientos_financieros add column if not exists gasto_fijo_id uuid references gastos_fijos(id);
create index idx_movimientos_gasto_fijo on movimientos_financieros(gasto_fijo_id) where gasto_fijo_id is not null;
