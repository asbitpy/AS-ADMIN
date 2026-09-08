-- ============================================================
-- AS ADMIN — Migración 002: mejoras para el flujo completo
-- Correr DESPUÉS de AS_ADMIN_esquema_base_datos.sql
-- ============================================================

-- 1. Identificador técnico de Meta por negocio (multi-tenant real):
--    el webhook recibe un phone_number_id y con esto sabemos a qué
--    negocio le llegó el mensaje.
alter table negocios add column if not exists whatsapp_phone_number_id text unique;

-- 2. Estado del flujo de conversación (máquina de estados del agendado):
--    acá se guarda en qué paso está el cliente (eligiendo servicio,
--    eligiendo franja, etc.) para que el bot retome donde quedó.
alter table conversaciones add column if not exists contexto jsonb not null default '{}';

-- 3. Deduplicación de mensajes: Meta puede reenviar el mismo webhook
--    si no respondemos a tiempo. Guardamos el id del mensaje de WhatsApp
--    y un índice único evita procesarlo dos veces.
alter table mensajes add column if not exists wa_message_id text;
create unique index if not exists idx_mensajes_wa_id
  on mensajes(wa_message_id) where wa_message_id is not null;

-- 4. Trigger: cuando un turno pasa a 'completado', se genera solo el
--    ingreso en movimientos_financieros. Esto es el corazón del módulo
--    de finanzas (Fase 2): el dueño nunca carga a mano lo que el
--    sistema ya sabe.
create or replace function fn_turno_completado_genera_ingreso()
returns trigger as $$
begin
  if new.estado = 'completado' and old.estado is distinct from 'completado' then
    insert into movimientos_financieros (negocio_id, tipo, monto, categoria, turno_id, origen, fecha)
    values (
      new.negocio_id,
      'ingreso',
      new.monto,
      'servicio',
      new.id,
      'automatico',
      (new.fecha_hora at time zone 'America/Asuncion')::date
    );
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_turno_completado on turnos;
create trigger trg_turno_completado
  after update on turnos
  for each row execute function fn_turno_completado_genera_ingreso();
