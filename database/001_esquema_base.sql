-- ============================================================
-- AS ADMIN — Esquema de base de datos (Postgres / Supabase)
-- ============================================================
-- Diseñado para soportar múltiples negocios (multi-tenant) desde
-- el día uno: todo cuelga de negocio_id, así el mismo motor sirve
-- para la clínica, la nutricionista, y cualquier cliente futuro.
-- ============================================================

-- ------------------------------------------------------------
-- ENUMS (estados controlados, evitan strings sueltos en el código)
-- ------------------------------------------------------------

create type turno_estado as enum (
  'pendiente',      -- agendado, todavía no confirmado
  'confirmado',     -- el cliente confirmó por el recordatorio
  'reprogramado',   -- se movió a otra fecha/hora
  'cancelado',
  'completado',     -- el cliente asistió y se atendió
  'no_show'         -- no asistió y no avisó
);

create type turno_origen as enum ('bot', 'manual', 'voz');

create type conversacion_canal as enum ('whatsapp', 'voz');

create type conversacion_estado as enum (
  'bot',              -- el bot está manejando la conversación
  'derivado_humano'   -- se marcó para que atienda una persona
);

create type conversacion_prioridad as enum ('normal', 'alta');

create type mensaje_remitente as enum ('cliente', 'bot', 'humano');

create type mensaje_tipo as enum ('texto', 'imagen', 'audio', 'video', 'documento');

create type pago_estado as enum ('pendiente_verificacion', 'confirmado', 'rechazado');

create type movimiento_tipo as enum ('ingreso', 'egreso');

create type movimiento_origen as enum ('automatico', 'manual');

create type lista_espera_estado as enum ('esperando', 'ofrecido', 'tomado', 'vencido');

-- ------------------------------------------------------------
-- NEGOCIOS (el tenant — cada cliente de AS ADMIN es un negocio)
-- ------------------------------------------------------------

create table negocios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rubro text not null,                    -- 'clinica', 'nutricionista', 'barberia', etc.
  direccion text,
  mapa_url text,
  telefono_whatsapp text not null unique, -- número de WhatsApp Business del negocio
  plan text not null default 'basico',    -- 'basico' | 'negocio' | 'full'
  tono text default 'cercano',            -- cómo debe hablar el bot
  config jsonb not null default '{}',     -- horarios, buffers entre turnos, reglas específicas
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Feriados y excepciones de horario por negocio
create table feriados_excepciones (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  fecha date not null,
  motivo text,
  creado_en timestamptz not null default now()
);
create index idx_feriados_negocio_fecha on feriados_excepciones(negocio_id, fecha);

-- ------------------------------------------------------------
-- PROFESIONALES (soporta clínicas con más de un profesional)
-- ------------------------------------------------------------

create table profesionales (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create index idx_profesionales_negocio on profesionales(negocio_id);

-- ------------------------------------------------------------
-- SERVICIOS (catálogo configurable por negocio)
-- ------------------------------------------------------------

create table servicios (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  nombre text not null,
  precio numeric(12,0) not null,          -- guaraníes, sin decimales
  duracion_minutos int not null default 30,
  es_recurrente boolean not null default false,
  recurrencia_dias int,                   -- ej. 15 = sugerir próximo control a los 15 días
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create index idx_servicios_negocio on servicios(negocio_id);

-- ------------------------------------------------------------
-- CLIENTES (los pacientes/clientes de cada negocio)
-- ------------------------------------------------------------

create table clientes (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  nombre text not null,
  telefono text not null,                 -- número de WhatsApp del cliente
  notas text,
  creado_en timestamptz not null default now(),
  unique (negocio_id, telefono)
);
create index idx_clientes_negocio on clientes(negocio_id);

-- ------------------------------------------------------------
-- TURNOS (el corazón del sistema — alimenta finanzas y métricas)
-- ------------------------------------------------------------

create table turnos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  profesional_id uuid references profesionales(id),
  servicio_id uuid not null references servicios(id),
  fecha_hora timestamptz not null,
  estado turno_estado not null default 'pendiente',
  origen turno_origen not null default 'bot',
  monto numeric(12,0) not null,           -- copiado del precio del servicio al momento de agendar
  recordatorio_24h_enviado boolean not null default false,
  recordatorio_mismo_dia_enviado boolean not null default false,
  turno_padre_id uuid references turnos(id), -- si nació de un turno recurrente, referencia al original
  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index idx_turnos_negocio_fecha on turnos(negocio_id, fecha_hora);
create index idx_turnos_cliente on turnos(cliente_id);
create index idx_turnos_estado on turnos(negocio_id, estado);

-- ------------------------------------------------------------
-- LISTA DE ESPERA (para franjas sin disponibilidad)
-- ------------------------------------------------------------

create table lista_espera (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  servicio_id uuid not null references servicios(id),
  franja_deseada_desde timestamptz,
  franja_deseada_hasta timestamptz,
  estado lista_espera_estado not null default 'esperando',
  creado_en timestamptz not null default now()
);
create index idx_lista_espera_negocio on lista_espera(negocio_id, estado);

-- ------------------------------------------------------------
-- CONVERSACIONES Y MENSAJES (historial del bot por cliente)
-- ------------------------------------------------------------

create table conversaciones (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  canal conversacion_canal not null default 'whatsapp',
  estado conversacion_estado not null default 'bot',
  prioridad conversacion_prioridad not null default 'normal',
  ultima_actividad timestamptz not null default now(),
  creado_en timestamptz not null default now()
);
create index idx_conversaciones_negocio_estado on conversaciones(negocio_id, estado);

create table mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references conversaciones(id) on delete cascade,
  remitente mensaje_remitente not null,
  tipo mensaje_tipo not null default 'texto',
  contenido text,                          -- texto del mensaje o URL del archivo
  intencion_detectada text,                -- lo que devolvió el clasificador (ej. "agendar_turno")
  metadata jsonb default '{}',             -- datos extraídos, categoría de imagen, etc.
  creado_en timestamptz not null default now()
);
create index idx_mensajes_conversacion on mensajes(conversacion_id, creado_en);

-- ------------------------------------------------------------
-- PAGOS (comprobantes recibidos por imagen, seña de turnos)
-- ------------------------------------------------------------

create table pagos (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid references turnos(id) on delete set null,
  negocio_id uuid not null references negocios(id) on delete cascade,
  monto numeric(12,0) not null,
  metodo text,                             -- 'transferencia', 'tigo_money', 'efectivo', etc.
  comprobante_url text,                    -- imagen del comprobante, si vino por WhatsApp
  estado pago_estado not null default 'pendiente_verificacion',
  verificado_por text,                     -- quién lo confirmó (dueño/humano)
  creado_en timestamptz not null default now()
);
create index idx_pagos_negocio on pagos(negocio_id, estado);

-- ------------------------------------------------------------
-- MOVIMIENTOS FINANCIEROS (módulo de finanzas — fase 2)
-- ------------------------------------------------------------

create table movimientos_financieros (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  tipo movimiento_tipo not null,
  monto numeric(12,0) not null,
  categoria text,                          -- 'servicio', 'alquiler', 'insumos', etc.
  turno_id uuid references turnos(id),     -- null si es un gasto manual sin relación a un turno
  origen movimiento_origen not null default 'manual',
  fecha date not null default current_date,
  notas text,
  creado_en timestamptz not null default now()
);
create index idx_movimientos_negocio_fecha on movimientos_financieros(negocio_id, fecha);

-- ------------------------------------------------------------
-- PRODUCTOS E INVENTARIO (módulo opcional — fase 3)
-- ------------------------------------------------------------

create table productos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  nombre text not null,
  precio numeric(12,0) not null,
  stock int not null default 0,
  stock_minimo int not null default 0,     -- dispara alerta cuando stock <= stock_minimo
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create index idx_productos_negocio on productos(negocio_id);

create table ventas_productos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  producto_id uuid not null references productos(id),
  cantidad int not null,
  monto_total numeric(12,0) not null,
  turno_id uuid references turnos(id),     -- si se vendió durante una consulta
  creado_en timestamptz not null default now()
);
create index idx_ventas_negocio on ventas_productos(negocio_id);

-- ============================================================
-- Notas de uso:
--
-- 1. Un turno "completado" es lo único que debería generar
--    automáticamente un movimiento_financiero de tipo 'ingreso'
--    (vía trigger o vía lógica en el backend) — así el dueño
--    nunca carga manualmente lo que el bot ya sabe.
--
-- 2. El campo config (jsonb) en 'negocios' guarda todo lo variable
--    por cliente sin tocar el esquema: horarios de atención,
--    buffers entre turnos, reglas de qué no debe responder el bot,
--    umbral de días de inactividad para reactivación, etc.
--
-- 3. 'conversaciones.prioridad = alta' es lo que debe mostrarse
--    primero en el panel del dueño (reclamos, derivaciones urgentes).
--
-- 4. Los índices ya cubren las consultas más frecuentes: turnos
--    del día por negocio, mensajes de una conversación en orden,
--    y movimientos financieros por rango de fecha.
-- ============================================================
