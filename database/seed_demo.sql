-- ============================================================
-- AS ADMIN — Datos de demostración
-- Correr DESPUÉS de las migraciones 001 → 008.
--
-- Carga un negocio híbrido (agenda + retail) con turnos de hoy, ventas
-- de la semana, catálogo con variantes y una conversación derivada, para
-- que al entrar al panel se vea el sistema con vida en vez de vacío.
--
-- NO es para producción: es para ver el sistema funcionando y para
-- probar cambios sin tocar datos de un cliente real.
--
-- Se puede correr las veces que haga falta: borra el negocio demo y lo
-- vuelve a crear. Solo toca ese negocio, nada más de la base.
-- ============================================================

begin;

-- Id fijo para que este script sea repetible sin ensuciar la base.
delete from negocios where id = 'a5b17000-0000-4000-8000-000000000001';

insert into negocios (
  id, nombre, rubro, direccion, telefono_whatsapp, tono, modulos_activos, config
) values (
  'a5b17000-0000-4000-8000-000000000001',
  'Nutrición Demo',
  'nutricionista',
  'Av. España 1234, Asunción',
  '595981000111',
  'cercano',
  -- Híbrido a propósito: así el panel muestra las dos familias de
  -- módulos (agenda y punto de venta) en la barra de navegación.
  array['agenda', 'pos', 'inventario'],
  '{
    "horarios": {
      "lun": ["08:00-12:00", "15:00-19:00"],
      "mar": ["08:00-12:00"],
      "mie": ["08:00-12:00", "15:00-19:00"],
      "jue": ["08:00-12:00"],
      "vie": ["08:00-12:00", "15:00-19:00"]
    },
    "horarios_texto": "Lunes a viernes de 8 a 12 y de 15 a 19"
  }'::jsonb
);

-- Si ya creaste tu usuario en Authentication y es el único, lo vinculamos
-- solo. Si hay varios, el script te dice qué correr a mano.
do $$
declare
  v_usuario uuid;
  v_cantidad int;
begin
  select count(*) into v_cantidad from auth.users;

  if v_cantidad = 1 then
    select id into v_usuario from auth.users;
    update negocios
       set auth_user_id = v_usuario
     where id = 'a5b17000-0000-4000-8000-000000000001';
    raise notice 'Negocio demo vinculado al usuario %', v_usuario;
  else
    raise notice 'Hay % usuarios en auth.users, no adivino cuál es el tuyo.', v_cantidad;
    raise notice 'Vinculalo a mano: update negocios set auth_user_id = ''UUID-DE-TU-USUARIO'' where id = ''a5b17000-0000-4000-8000-000000000001'';';
  end if;
end $$;


-- ------------------------------------------------------------
-- Servicios
-- ------------------------------------------------------------

insert into servicios (id, negocio_id, nombre, precio, duracion_minutos, es_recurrente, recurrencia_dias) values
  ('a5b17000-0000-4000-8000-000000000101', 'a5b17000-0000-4000-8000-000000000001', 'Primera consulta', 150000, 45, false, null),
  ('a5b17000-0000-4000-8000-000000000102', 'a5b17000-0000-4000-8000-000000000001', 'Control',           100000, 30, true,  15),
  ('a5b17000-0000-4000-8000-000000000103', 'a5b17000-0000-4000-8000-000000000001', 'Plan deportivo',    200000, 60, false, null);


-- ------------------------------------------------------------
-- Clientes
-- ------------------------------------------------------------

insert into clientes (id, negocio_id, nombre, telefono) values
  ('a5b17000-0000-4000-8000-000000000201', 'a5b17000-0000-4000-8000-000000000001', 'María González',  '595981234501'),
  ('a5b17000-0000-4000-8000-000000000202', 'a5b17000-0000-4000-8000-000000000001', 'Carlos Benítez',  '595981234502'),
  ('a5b17000-0000-4000-8000-000000000203', 'a5b17000-0000-4000-8000-000000000001', 'Lucía Ramírez',   '595981234503'),
  ('a5b17000-0000-4000-8000-000000000204', 'a5b17000-0000-4000-8000-000000000001', 'Diego Fernández', '595981234504');


-- ------------------------------------------------------------
-- Turnos de HOY (los que se ven en la vista Hoy y en la línea de tiempo)
-- ------------------------------------------------------------
-- Los horarios no se pisan entre sí a propósito: la restricción
-- turnos_sin_solape (migración 007) rechazaría el segundo si lo hicieran.

insert into turnos (id, negocio_id, cliente_id, servicio_id, fecha_hora, duracion_minutos, estado, origen, monto) values
  ('a5b17000-0000-4000-8000-000000000301', 'a5b17000-0000-4000-8000-000000000001',
   'a5b17000-0000-4000-8000-000000000201', 'a5b17000-0000-4000-8000-000000000101',
   (current_date + time '09:00') at time zone 'America/Asuncion', 45, 'confirmado', 'bot', 150000),

  ('a5b17000-0000-4000-8000-000000000302', 'a5b17000-0000-4000-8000-000000000001',
   'a5b17000-0000-4000-8000-000000000202', 'a5b17000-0000-4000-8000-000000000102',
   (current_date + time '10:30') at time zone 'America/Asuncion', 30, 'pendiente', 'bot', 100000),

  ('a5b17000-0000-4000-8000-000000000303', 'a5b17000-0000-4000-8000-000000000001',
   'a5b17000-0000-4000-8000-000000000203', 'a5b17000-0000-4000-8000-000000000102',
   (current_date + time '15:00') at time zone 'America/Asuncion', 30, 'confirmado', 'bot', 100000),

  ('a5b17000-0000-4000-8000-000000000304', 'a5b17000-0000-4000-8000-000000000001',
   'a5b17000-0000-4000-8000-000000000204', 'a5b17000-0000-4000-8000-000000000103',
   (current_date + time '16:30') at time zone 'America/Asuncion', 60, 'pendiente', 'bot', 200000);


-- ------------------------------------------------------------
-- Turnos ya atendidos de la semana pasada
-- ------------------------------------------------------------
-- Se insertan pendientes y recién después se marcan completados: el
-- ingreso en movimientos_financieros lo genera el trigger al pasar a
-- 'completado', igual que cuando el dueño toca "Atendido ✓" en el panel.
-- Es lo que hace que la vista Hoy muestre cuánto se facturó.

insert into turnos (id, negocio_id, cliente_id, servicio_id, fecha_hora, duracion_minutos, estado, origen, monto) values
  ('a5b17000-0000-4000-8000-000000000311', 'a5b17000-0000-4000-8000-000000000001',
   'a5b17000-0000-4000-8000-000000000201', 'a5b17000-0000-4000-8000-000000000102',
   (current_date - 2 + time '09:00') at time zone 'America/Asuncion', 30, 'pendiente', 'bot', 100000),

  ('a5b17000-0000-4000-8000-000000000312', 'a5b17000-0000-4000-8000-000000000001',
   'a5b17000-0000-4000-8000-000000000202', 'a5b17000-0000-4000-8000-000000000101',
   (current_date - 3 + time '10:00') at time zone 'America/Asuncion', 45, 'pendiente', 'bot', 150000),

  ('a5b17000-0000-4000-8000-000000000313', 'a5b17000-0000-4000-8000-000000000001',
   'a5b17000-0000-4000-8000-000000000203', 'a5b17000-0000-4000-8000-000000000103',
   (current_date - 4 + time '16:00') at time zone 'America/Asuncion', 60, 'pendiente', 'bot', 200000);

update turnos
   set estado = 'completado'
 where id in (
   'a5b17000-0000-4000-8000-000000000311',
   'a5b17000-0000-4000-8000-000000000312',
   'a5b17000-0000-4000-8000-000000000313'
 );

-- Un no_show, para que la métrica de ausencias no arranque en cero.
insert into turnos (id, negocio_id, cliente_id, servicio_id, fecha_hora, duracion_minutos, estado, origen, monto) values
  ('a5b17000-0000-4000-8000-000000000314', 'a5b17000-0000-4000-8000-000000000001',
   'a5b17000-0000-4000-8000-000000000204', 'a5b17000-0000-4000-8000-000000000102',
   (current_date - 1 + time '11:00') at time zone 'America/Asuncion', 30, 'no_show', 'bot', 100000);


-- ------------------------------------------------------------
-- Una conversación derivada a humano (la alerta de la vista Hoy)
-- ------------------------------------------------------------

insert into conversaciones (id, negocio_id, cliente_id, canal, estado, prioridad, ultima_actividad) values
  ('a5b17000-0000-4000-8000-000000000401', 'a5b17000-0000-4000-8000-000000000001',
   'a5b17000-0000-4000-8000-000000000203', 'whatsapp', 'derivado_humano', 'alta', now() - interval '25 minutes');

insert into mensajes (conversacion_id, remitente, tipo, contenido, intencion_detectada, creado_en) values
  ('a5b17000-0000-4000-8000-000000000401', 'cliente', 'texto',
   'Hola, vengo con dolor de estómago desde ayer y no sé si puedo seguir el plan',
   null, now() - interval '26 minutes'),
  ('a5b17000-0000-4000-8000-000000000401', 'bot', 'texto',
   'Gracias por escribir 🙌 Le paso tu mensaje al equipo para que te responda directamente.',
   'contenido_medico', now() - interval '25 minutes');


-- ------------------------------------------------------------
-- Catálogo retail (pestañas Productos y Vender)
-- ------------------------------------------------------------

insert into categorias (id, negocio_id, nombre) values
  ('a5b17000-0000-4000-8000-000000000501', 'a5b17000-0000-4000-8000-000000000001', 'Suplementos'),
  ('a5b17000-0000-4000-8000-000000000502', 'a5b17000-0000-4000-8000-000000000001', 'Accesorios');

insert into productos (
  id, negocio_id, nombre, precio, stock, stock_minimo, categoria_id,
  sku, codigo_barras, costo, tiene_variantes, activo
) values
  -- Stock por debajo del mínimo: dispara la alerta de stock bajo.
  ('a5b17000-0000-4000-8000-000000000601', 'a5b17000-0000-4000-8000-000000000001',
   'Proteína vainilla 1kg', 210000, 2, 5, 'a5b17000-0000-4000-8000-000000000501',
   'PROT-VAI-1K', '7840001000011', 140000, false, true),

  ('a5b17000-0000-4000-8000-000000000602', 'a5b17000-0000-4000-8000-000000000001',
   'Botella térmica 750ml', 95000, 8, 3, 'a5b17000-0000-4000-8000-000000000502',
   'BOT-750', '7840001000028', 55000, false, true),

  -- Con variantes: el stock real vive en cada variante, no acá.
  ('a5b17000-0000-4000-8000-000000000603', 'a5b17000-0000-4000-8000-000000000001',
   'Remera deportiva', 120000, 0, 0, 'a5b17000-0000-4000-8000-000000000502',
   'REM-DEP', null, 70000, true, true);

insert into variantes_producto (
  producto_id, negocio_id, atributo1_nombre, atributo1_valor,
  atributo2_nombre, atributo2_valor, sku, codigo_barras, stock, precio_override
) values
  ('a5b17000-0000-4000-8000-000000000603', 'a5b17000-0000-4000-8000-000000000001',
   'Talle', 'S', 'Color', 'Negro', 'REM-DEP-S-NE', '7840001000103', 4, null),
  ('a5b17000-0000-4000-8000-000000000603', 'a5b17000-0000-4000-8000-000000000001',
   'Talle', 'M', 'Color', 'Negro', 'REM-DEP-M-NE', '7840001000110', 6, null),
  ('a5b17000-0000-4000-8000-000000000603', 'a5b17000-0000-4000-8000-000000000001',
   'Talle', 'L', 'Color', 'Verde', 'REM-DEP-L-VE', '7840001000127', 2, null),
  -- Con precio propio: sirve para comprobar que el POS cobra el precio
  -- de la variante y no el del producto padre.
  ('a5b17000-0000-4000-8000-000000000603', 'a5b17000-0000-4000-8000-000000000001',
   'Talle', 'XL', 'Color', 'Verde', 'REM-DEP-XL-VE', '7840001000134', 3, 135000);

commit;

-- ============================================================
-- Qué deberías ver al entrar al panel:
--
--   Hoy       → 4 turnos, 2 confirmados, 1 alerta roja (derivada) y
--               "esta semana facturaste Gs. 450.000"
--   Turnos    → los de hoy más los de la semana
--   Vender    → buscá "remera" y elegí un talle; el XL sale 135.000 y
--               los demás 120.000
--   Productos → 3 productos, con "Proteína vainilla" en stock bajo
--
-- Para borrar todo esto cuando ya no lo necesites:
--   delete from negocios where id = 'a5b17000-0000-4000-8000-000000000001';
-- ============================================================
