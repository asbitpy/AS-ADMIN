-- ============================================================
-- AS ADMIN — Migración 004: núcleo retail (Fase 4)
-- Correr DESPUÉS de 003_panel_auth_rls.sql
--
-- Extiende el sistema para soportar negocios de retail sin tocar
-- nada de lo que ya usan los negocios de servicio. La tabla
-- 'productos' que ya existía (Fase 3, inventario liviano) se
-- extiende en vez de duplicarse.
-- ============================================================

-- ------------------------------------------------------------
-- ENUMS nuevos
-- ------------------------------------------------------------

create type venta_estado as enum ('completada', 'anulada');
create type venta_canal as enum ('local', 'ecommerce', 'whatsapp');
create type movimiento_inventario_tipo as enum ('entrada', 'salida', 'ajuste', 'transferencia', 'venta', 'devolucion');
create type caja_sesion_estado as enum ('abierta', 'cerrada');
create type metodo_pago as enum ('efectivo', 'transferencia', 'tarjeta', 'qr', 'credito');

-- ------------------------------------------------------------
-- MÓDULOS ACTIVOS por negocio — el corazón de la unificación
-- ------------------------------------------------------------

alter table negocios add column if not exists modulos_activos text[] not null default array['agenda'];
-- valores posibles: 'agenda', 'pos', 'inventario', 'proveedores', 'compras',
-- 'ecommerce', 'facturacion', 'automatizaciones', 'ia'
-- Un negocio híbrido simplemente tiene ambos sets en el array.

comment on column negocios.modulos_activos is
  'Determina qué ve el dueño en el panel y qué ramas usa el bot de WhatsApp. Nunca mostrar un módulo que el negocio no activó.';

-- ------------------------------------------------------------
-- CATEGORÍAS (jerárquicas, para organizar el catálogo)
-- ------------------------------------------------------------

create table categorias (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  nombre text not null,
  categoria_padre_id uuid references categorias(id),
  creado_en timestamptz not null default now()
);
create index idx_categorias_negocio on categorias(negocio_id);

-- ------------------------------------------------------------
-- PRODUCTOS — se extiende la tabla que ya existía (Fase 3)
-- ------------------------------------------------------------

alter table productos add column if not exists sku text;
alter table productos add column if not exists codigo_barras text;
alter table productos add column if not exists categoria_id uuid references categorias(id);
alter table productos add column if not exists marca text;
alter table productos add column if not exists proveedor_id uuid; -- FK se agrega abajo, después de crear 'proveedores'
alter table productos add column if not exists costo numeric(12,0);
alter table productos add column if not exists precio_mayorista numeric(12,0);
alter table productos add column if not exists impuesto_porcentaje numeric(5,2) default 10; -- IVA 10% por defecto
alter table productos add column if not exists descripcion text;
alter table productos add column if not exists foto_url text;
alter table productos add column if not exists tiene_variantes boolean not null default false;

create unique index if not exists idx_productos_sku on productos(negocio_id, sku) where sku is not null;
create unique index if not exists idx_productos_barcode on productos(negocio_id, codigo_barras) where codigo_barras is not null;

-- ------------------------------------------------------------
-- VARIANTES DE PRODUCTO (talle, color, modelo...)
-- ------------------------------------------------------------

create table variantes_producto (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references productos(id) on delete cascade,
  negocio_id uuid not null references negocios(id) on delete cascade, -- denormalizado para RLS simple
  atributo1_nombre text, -- ej. 'Talle'
  atributo1_valor text,  -- ej. 'M'
  atributo2_nombre text, -- ej. 'Color'
  atributo2_valor text,  -- ej. 'Negro'
  sku text,
  codigo_barras text,
  stock int not null default 0,
  precio_override numeric(12,0), -- null = usa el precio del producto padre
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create index idx_variantes_producto on variantes_producto(producto_id);
create index idx_variantes_negocio on variantes_producto(negocio_id);
create unique index if not exists idx_variantes_barcode on variantes_producto(negocio_id, codigo_barras) where codigo_barras is not null;

-- ------------------------------------------------------------
-- MOVIMIENTOS DE INVENTARIO — fuente de verdad del stock.
-- Nunca se actualiza 'stock' directamente sin dejar este registro.
-- ------------------------------------------------------------

create table movimientos_inventario (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  producto_id uuid references productos(id),
  variante_id uuid references variantes_producto(id),
  tipo movimiento_inventario_tipo not null,
  cantidad int not null, -- positivo = entra, negativo = sale
  motivo text,
  referencia_venta_id uuid, -- se referencia luego de crear 'ventas'
  usuario_id uuid,
  creado_en timestamptz not null default now(),
  check (producto_id is not null or variante_id is not null)
);
create index idx_mov_inventario_negocio on movimientos_inventario(negocio_id, creado_en);
create index idx_mov_inventario_producto on movimientos_inventario(producto_id);
create index idx_mov_inventario_variante on movimientos_inventario(variante_id);

-- ------------------------------------------------------------
-- SESIONES DE CAJA (apertura/cierre/arqueo)
-- ------------------------------------------------------------

create table caja_sesiones (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  usuario_id uuid, -- quién abrió la caja (se referencia cuando exista 'usuarios')
  abierta_en timestamptz not null default now(),
  cerrada_en timestamptz,
  monto_inicial numeric(12,0) not null default 0,
  monto_esperado numeric(12,0), -- calculado al cerrar: inicial + ingresos - egresos
  monto_real numeric(12,0),     -- lo que el cajero contó a mano
  diferencia numeric(12,0),     -- monto_real - monto_esperado
  estado caja_sesion_estado not null default 'abierta',
  notas text
);
create index idx_caja_sesiones_negocio on caja_sesiones(negocio_id, estado);

-- 'movimientos_financieros' (ya existía) se extiende para poder
-- opcionalmente atarse a una sesión de caja abierta:
alter table movimientos_financieros add column if not exists caja_sesion_id uuid references caja_sesiones(id);

-- ------------------------------------------------------------
-- VENTAS (POS)
-- ------------------------------------------------------------

create table ventas (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  cliente_id uuid references clientes(id),
  usuario_id uuid, -- vendedor/cajero que hizo la venta
  caja_sesion_id uuid references caja_sesiones(id),
  canal venta_canal not null default 'local',
  subtotal numeric(12,0) not null,
  descuento numeric(12,0) not null default 0,
  impuesto numeric(12,0) not null default 0,
  total numeric(12,0) not null,
  metodo_pago metodo_pago not null default 'efectivo',
  estado venta_estado not null default 'completada',
  anulada_por uuid,
  anulada_motivo text,
  creado_en timestamptz not null default now()
);
create index idx_ventas_negocio_fecha on ventas(negocio_id, creado_en);
create index idx_ventas_caja_sesion on ventas(caja_sesion_id);

create table venta_items (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references ventas(id) on delete cascade,
  producto_id uuid not null references productos(id),
  variante_id uuid references variantes_producto(id),
  cantidad int not null,
  precio_unitario numeric(12,0) not null,
  descuento numeric(12,0) not null default 0
);
create index idx_venta_items_venta on venta_items(venta_id);

-- ------------------------------------------------------------
-- PROVEEDORES Y COMPRAS
-- ------------------------------------------------------------

create table proveedores (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  nombre text not null,
  contacto text,
  telefono text,
  email text,
  notas text,
  creado_en timestamptz not null default now()
);
create index idx_proveedores_negocio on proveedores(negocio_id);

-- Ahora sí conectamos productos.proveedor_id
alter table productos add constraint fk_productos_proveedor
  foreign key (proveedor_id) references proveedores(id);

create type orden_compra_estado as enum ('borrador', 'enviada', 'recibida', 'cancelada');

create table ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  proveedor_id uuid not null references proveedores(id),
  estado orden_compra_estado not null default 'borrador',
  total numeric(12,0) not null default 0,
  fecha date not null default current_date,
  recibida_en timestamptz,
  creado_en timestamptz not null default now()
);
create index idx_ordenes_compra_negocio on ordenes_compra(negocio_id, estado);

create table orden_compra_items (
  id uuid primary key default gen_random_uuid(),
  orden_compra_id uuid not null references ordenes_compra(id) on delete cascade,
  producto_id uuid not null references productos(id),
  variante_id uuid references variantes_producto(id),
  cantidad int not null,
  costo_unitario numeric(12,0) not null
);
create index idx_orden_compra_items_orden on orden_compra_items(orden_compra_id);

-- ------------------------------------------------------------
-- CRÉDITO / DEUDA de clientes (venta a crédito)
-- ------------------------------------------------------------

alter table clientes add column if not exists fecha_nacimiento date;
alter table clientes add column if not exists credito_disponible numeric(12,0) default 0;

create type credito_estado as enum ('pendiente', 'pagado', 'vencido');

create table creditos_clientes (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  venta_id uuid references ventas(id),
  monto numeric(12,0) not null,
  saldo_pendiente numeric(12,0) not null,
  fecha_vencimiento date,
  estado credito_estado not null default 'pendiente',
  creado_en timestamptz not null default now()
);
create index idx_creditos_negocio on creditos_clientes(negocio_id, estado);

-- ------------------------------------------------------------
-- FUNCIÓN: descuento de stock ATÓMICO (evita vender lo mismo dos veces)
-- ------------------------------------------------------------
-- Se llama DENTRO de la misma transacción que crea la venta. Si el
-- stock no alcanza, lanza una excepción y toda la venta se revierte.

create or replace function fn_descontar_stock(
  p_producto_id uuid,
  p_variante_id uuid,
  p_cantidad int,
  p_negocio_id uuid,
  p_referencia_venta_id uuid
) returns void as $$
declare
  v_stock_actual int;
begin
  if p_variante_id is not null then
    select stock into v_stock_actual from variantes_producto where id = p_variante_id for update;
    if v_stock_actual < p_cantidad then
      raise exception 'Stock insuficiente para la variante %', p_variante_id;
    end if;
    update variantes_producto set stock = stock - p_cantidad where id = p_variante_id;
  else
    select stock into v_stock_actual from productos where id = p_producto_id for update;
    if v_stock_actual < p_cantidad then
      raise exception 'Stock insuficiente para el producto %', p_producto_id;
    end if;
    update productos set stock = stock - p_cantidad where id = p_producto_id;
  end if;

  insert into movimientos_inventario (negocio_id, producto_id, variante_id, tipo, cantidad, referencia_venta_id, motivo)
  values (p_negocio_id, p_producto_id, p_variante_id, 'venta', -p_cantidad, p_referencia_venta_id, 'Venta POS');
end;
$$ language plpgsql;

-- ------------------------------------------------------------
-- TRIGGER: venta completada -> ingreso automático en movimientos_financieros
-- (mismo principio que ya usamos con turnos completados)
-- ------------------------------------------------------------

create or replace function fn_venta_genera_ingreso()
returns trigger as $$
begin
  if new.estado = 'completada' then
    insert into movimientos_financieros (negocio_id, tipo, monto, categoria, origen, fecha, caja_sesion_id)
    values (new.negocio_id, 'ingreso', new.total, 'venta', 'automatico', current_date, new.caja_sesion_id);
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_venta_completada
  after insert on ventas
  for each row execute function fn_venta_genera_ingreso();

-- ============================================================
-- Notas de uso:
--
-- 1. NUNCA hacer `update variantes_producto set stock = ...` a mano
--    desde el backend — siempre a través de fn_descontar_stock() o de
--    un insert directo en movimientos_inventario (para entradas,
--    ajustes, devoluciones), para que el historial quede completo.
--
-- 2. 'modulos_activos' en negocios es lo que el panel y el bot
--    consultan para decidir qué mostrar/ofrecer. Nunca hardcodear
--    "si es clínica, mostrar X" — siempre chequear el array.
--
-- 3. RLS: falta agregar políticas para las tablas nuevas siguiendo
--    el mismo patrón de 003_panel_auth_rls.sql (queda como tarea
--    inmediata antes de conectar el panel a estas tablas).
-- ============================================================
