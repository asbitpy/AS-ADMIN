-- ============================================================
-- AS ADMIN — Migración 008: credenciales de WhatsApp por negocio
-- Correr DESPUÉS de 007_precio_servidor_y_antisolape.sql
--
-- El backend ya sabía de QUÉ negocio venía cada mensaje (rutea por
-- negocios.whatsapp_phone_number_id), pero al responder usaba siempre
-- el número y el token únicos del .env. Con un solo negocio piloto no
-- se nota; con el segundo cliente, todas las respuestas saldrían por
-- el número equivocado.
--
-- Por qué una tabla aparte y no columnas en 'negocios': el panel hace
-- select('*') sobre negocios con la anon key, así que cualquier
-- columna de esa tabla termina viajando al navegador del dueño. El
-- token de WhatsApp es un secreto que permite mandar mensajes en
-- nombre del negocio — no puede estar ahí.
-- ============================================================

create table if not exists negocios_credenciales (
  negocio_id uuid primary key references negocios(id) on delete cascade,
  whatsapp_token text,
  template_recordatorio_24h text,
  template_recordatorio_hoy text,
  actualizado_en timestamptz not null default now()
);

comment on table negocios_credenciales is
  'Secretos por negocio (token de WhatsApp, nombres de plantillas aprobadas). Solo el backend, con la service key, puede leer esta tabla.';

-- RLS activo y SIN políticas, a propósito: con RLS habilitado y ninguna
-- política, nadie que use la anon key o una sesión de usuario puede leer
-- ni escribir esta tabla. La service key del backend ignora RLS, así que
-- el bot sí la lee. Es la forma de decir "esto no sale del servidor".
alter table negocios_credenciales enable row level security;

-- ============================================================
-- Alta de un negocio nuevo (a mano, por ahora):
--
--   update negocios
--      set whatsapp_phone_number_id = 'ID-DEL-NUMERO-EN-META'
--    where id = 'UUID-DEL-NEGOCIO';
--
--   insert into negocios_credenciales (
--     negocio_id, whatsapp_token, template_recordatorio_24h, template_recordatorio_hoy
--   ) values (
--     'UUID-DEL-NEGOCIO', 'TOKEN-PERMANENTE-DE-META', 'recordatorio_24h', 'recordatorio_hoy'
--   );
--
-- Si un negocio no tiene fila acá, el backend usa lo que haya en el
-- .env — así el negocio piloto sigue funcionando sin tocar nada.
-- ============================================================
