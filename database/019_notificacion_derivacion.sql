-- ============================================================
-- AS ADMIN — Migración 019: aviso al dueño cuando el bot deriva a humano
-- Correr DESPUÉS de 018_gastos_fijos.sql
--
-- Cierra el pendiente de la Fase 1: hasta ahora el bot marcaba la
-- conversación como 'derivado_humano' pero nadie se enteraba salvo que
-- abriera el panel. Mismo patrón que la alerta de stock bajo (Etapa 3
-- del bot retail): necesita una plantilla aprobada en Meta porque puede
-- pasar en cualquier momento, no solo dentro de la ventana de 24hs.
-- ============================================================

alter table negocios_credenciales add column if not exists template_derivacion_humano text;

comment on column negocios_credenciales.template_derivacion_humano is
  'Nombre de la plantilla aprobada en Meta para avisarle al dueño (negocios.config.telefono_dueno) cuando una conversación se deriva a humano. Cuerpo sugerido: "🙋 {{1}} necesita ayuda — {{2}}"';
