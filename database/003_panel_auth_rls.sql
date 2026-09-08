-- ============================================================
-- AS ADMIN — Migración 003: autenticación del panel + RLS
-- Correr DESPUÉS de 002_mejoras_flujo.sql
-- ============================================================
-- El backend del bot sigue usando la service key (bypassea RLS).
-- El PANEL usa la anon key + sesión del dueño logueado, así que
-- necesita estas políticas para que cada dueño vea solo su negocio.
-- ============================================================

-- 1. Vínculo entre el negocio y su usuario de Supabase Auth
alter table negocios add column if not exists auth_user_id uuid references auth.users(id);

-- 2. Habilitar RLS en todas las tablas que el panel consulta directo
alter table negocios enable row level security;
alter table clientes enable row level security;
alter table servicios enable row level security;
alter table turnos enable row level security;
alter table conversaciones enable row level security;
alter table mensajes enable row level security;
alter table movimientos_financieros enable row level security;
alter table productos enable row level security;
alter table feriados_excepciones enable row level security;
alter table lista_espera enable row level security;

-- 3. Política base: el dueño solo ve/edita su propio negocio
drop policy if exists "dueño ve su negocio" on negocios;
create policy "dueño ve su negocio" on negocios
  for all using (auth_user_id = auth.uid());

-- 4. Política reutilizable para el resto de las tablas: acceso solo si
--    negocio_id pertenece a un negocio cuyo auth_user_id es el usuario actual
do $$
declare
  tabla text;
begin
  foreach tabla in array array[
    'clientes', 'servicios', 'turnos', 'conversaciones', 'mensajes',
    'movimientos_financieros', 'productos', 'feriados_excepciones', 'lista_espera'
  ]
  loop
    execute format(
      'drop policy if exists "dueño ve su data" on %I;', tabla
    );
    execute format(
      'create policy "dueño ve su data" on %I for all using (
        negocio_id in (select id from negocios where auth_user_id = auth.uid())
      );', tabla
    );
  end loop;
end $$;

-- ============================================================
-- Cómo dar de alta al dueño de un negocio nuevo (a mano, por ahora):
--
-- 1. Crear el usuario en Supabase → Authentication → Add user
--    (o supabase.auth.admin.createUser desde un script)
-- 2. Copiar su UUID
-- 3. UPDATE negocios SET auth_user_id = 'UUID-DEL-USUARIO' WHERE id = '...';
--
-- Más adelante esto se puede automatizar en el flujo de onboarding.
-- ============================================================
