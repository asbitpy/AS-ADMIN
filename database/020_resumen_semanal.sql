-- ============================================================
-- AS ADMIN — Migración 020: resumen semanal proactivo al dueño
-- Correr DESPUÉS de 019_notificacion_derivacion.sql
--
-- Los lunes, si el negocio tiene telefono_dueno y la plantilla
-- cargada, se manda un WhatsApp con ingresos/egresos/neto de los
-- últimos 7 días. resumen_semanal_enviado_en evita mandarlo más de una
-- vez por semana (mismo criterio que alerta_stock_baja_enviada).
-- ============================================================

alter table negocios add column if not exists resumen_semanal_enviado_en timestamptz;

comment on column negocios.resumen_semanal_enviado_en is
  'Última vez que se mandó el resumen semanal por WhatsApp. Evita reenviarlo más de una vez por semana.';

alter table negocios_credenciales add column if not exists template_resumen_semanal text;

comment on column negocios_credenciales.template_resumen_semanal is
  'Nombre de la plantilla aprobada en Meta para el resumen semanal. Cuerpo sugerido: "📊 Esta semana: {{1}} de ingresos, {{2}} de egresos, {{3}} neto."';
