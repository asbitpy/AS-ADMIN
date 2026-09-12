-- ============================================================
-- AS ADMIN — Migración 014: alerta de stock bajo al dueño
-- Correr DESPUÉS de 013_reservas_whatsapp.sql
--
-- Etapa 3 del bot retail (ver
-- docs/AS_ADMIN_bot_whatsapp_v3_retail_inventario.md, sección 6a):
-- solo lectura + notificación. El sistema NUNCA decide ni ejecuta una
-- reposición acá — solo le avisa al dueño por WhatsApp cuando un
-- producto cruza su stock mínimo, para que decida él.
-- ============================================================

-- Evita mandar el mismo aviso en cada corrida del job (cada 5 minutos)
-- mientras el producto se mantenga bajo. Se resetea sola cuando el
-- stock vuelve a subir por encima del mínimo, así una próxima bajada
-- SÍ vuelve a avisar.
alter table productos add column if not exists alerta_stock_baja_enviada boolean not null default false;

comment on column productos.alerta_stock_baja_enviada is
  'true = ya se le avisó al dueño de este stock bajo. Se resetea a false cuando el stock vuelve a superar stock_minimo.';

-- Mismo patrón que template_recordatorio_24h / template_recordatorio_hoy
-- (migración 008): el nombre de la plantilla aprobada en Meta Business
-- Manager para este aviso, configurable por negocio.
alter table negocios_credenciales add column if not exists template_alerta_stock text;

-- ============================================================
-- Notas de uso:
--
-- 1. El número de WhatsApp del DUEÑO (no el del negocio, que es el que
--    reciben los clientes) se configura en negocios.config, ej.:
--
--      update negocios
--         set config = config || '{"telefono_dueno": "+595981234567"}'::jsonb
--       where id = 'UUID-DEL-NEGOCIO';
--
--    No se agregó una columna nueva porque ya existe 'config' jsonb
--    para settings opcionales por negocio (mismo lugar donde vive
--    'reserva_horas' para las reservas de pedido).
--
-- 2. La plantilla de Meta se registra igual que las de recordatorios
--    (ver notas de la migración 008):
--
--      update negocios_credenciales
--         set template_alerta_stock = 'alerta_stock_bajo'
--       where negocio_id = 'UUID-DEL-NEGOCIO';
--
--    Cuerpo sugerido para esa plantilla en Meta Business Manager:
--    "📦 Se está por agotar {{1}} — quedan {{2}} unidades."
--
-- 3. Si un negocio no tiene 'telefono_dueno' o la plantilla cargada,
--    simplemente no recibe este aviso — el resto del bot sigue
--    funcionando normal (mismo criterio que recordatorios).
-- ============================================================
