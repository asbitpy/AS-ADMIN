-- ============================================================
-- AS ADMIN — Migración 025: más datos de cada empleado
-- Correr DESPUÉS de 024_proveedores_compras.sql
--
-- La ficha de escritorio (Equipo → detalle) pedía poder cargar más
-- datos de cada persona además de sueldo/horario — contacto y algún
-- dato de referencia básico. Mismo criterio que el resto: todo
-- opcional (nulo = todavía no cargado), sin validar formato acá, eso
-- queda para la UI.
-- ============================================================

alter table usuarios add column if not exists telefono text;
alter table usuarios add column if not exists email text;
alter table usuarios add column if not exists documento text;
alter table usuarios add column if not exists fecha_ingreso date;
alter table usuarios add column if not exists notas text;

comment on column usuarios.telefono is 'Teléfono de contacto del empleado, en el formato que se cargue (sin validar).';
comment on column usuarios.email is 'Email de contacto del empleado — no es su login, ese es auth_user_id.';
comment on column usuarios.documento is 'Cédula de identidad u otro documento de referencia.';
comment on column usuarios.fecha_ingreso is 'Desde cuándo trabaja en el negocio.';
comment on column usuarios.notas is 'Observaciones libres (contacto de emergencia, etc.).';

-- Ya cubierto por las políticas de 011_usuarios_y_roles.sql — estas
-- columnas quedan protegidas igual que el resto de la fila (el equipo
-- las ve, solo el dueño las edita).
