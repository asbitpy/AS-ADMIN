-- ============================================================
-- AS ADMIN — Migración 022: sueldo y horario semanal por empleado
-- Correr DESPUÉS de 021_clientes_deuda.sql
--
-- Lo que pidió Arturo para que la ficha de cada empleado (Equipo →
-- detalle) quede completa: sueldo y qué días/horarios trabaja (los
-- días sin franja cargada son sus días libres, sin necesidad de un
-- campo aparte).
--
-- A propósito NO es la migración de "Jornadas" del documento de
-- pantallas y escritorio (grilla semanal de turnos de trabajo,
-- fichaje de entrada/salida, comisiones) — eso sigue siendo un módulo
-- aparte, más grande, todavía sin diseñar. Esto es más chico: un
-- horario de referencia por persona, mismo formato que ya usa
-- 'negocios.config.horarios' (día → array de "HH:MM-HH:MM"), para no
-- inventar un formato nuevo que el resto del sistema no entiende.
-- ============================================================

alter table usuarios add column if not exists sueldo numeric(12,0);
alter table usuarios add column if not exists horario jsonb not null default '{}';

comment on column usuarios.sueldo is
  'Sueldo mensual de referencia, en guaraníes. Nulo = todavía no cargado.';
comment on column usuarios.horario is
  'Mismo formato que negocios.config.horarios: {"lun": ["08:00-12:00", "14:00-18:00"], ...}. Un día sin franjas es su día libre.';

-- Ya cubierto por las políticas de 011_usuarios_y_roles.sql: 'equipo
-- ve su propio equipo' (select) y 'solo el dueño edita empleados'
-- (update) — estas dos columnas nuevas quedan protegidas igual que el
-- resto de la fila, sin política nueva.
