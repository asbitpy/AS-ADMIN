-- ============================================================
-- AS ADMIN — Migración 030: nombre del dueño
-- Correr DESPUÉS de 029_permisos_extra.sql
--
-- 'negocios.nombre' es el nombre DEL NEGOCIO ("Nutrición Demo"), no de
-- la persona. Sin un campo aparte, cada pantalla que muestra "quién
-- hizo esto" (Ventas, Caja, Inventario, Finanzas, Equipo, Jornadas)
-- mostraba "Vos" en vez del nombre real del dueño — a diferencia de un
-- empleado, que sí tiene su nombre en usuarios.nombre. Opcional: si no
-- se carga, todo sigue mostrando "Vos" como hasta ahora.
-- ============================================================

alter table negocios add column if not exists nombre_dueno text;

comment on column negocios.nombre_dueno is
  'Nombre de la persona dueña del negocio (no el nombre del negocio) — se usa en vez de "Vos" en las pantallas que muestran quién hizo cada cosa. Nulo = sigue mostrando "Vos".';
