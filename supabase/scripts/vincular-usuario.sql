-- =============================================================================
-- Vincular un usuario de Supabase Auth con el negocio.
--
-- Se usa después de crear la persona en el panel de Supabase
-- (Authentication → Users → Add user), que le asigna un UUID propio.
--
-- Cómo se usa: pegar todo este archivo en el SQL Editor de Supabase y ejecutar.
-- Después, llamar a la función una vez por persona:
--
--   select app.vincular_usuario('dueno@tudominio.com',    'owner',    'Tu Nombre');
--   select app.vincular_usuario('empleado@tudominio.com', 'employee', 'Nombre del Empleado');
--
-- Es idempotente: correrla dos veces con el mismo correo no duplica nada.
--
-- Nota: este archivo NO crea nada dentro del esquema `auth`. En Supabase ese
-- esquema pertenece a `supabase_auth_admin` y ni siquiera el rol `postgres`
-- puede escribir ahí; solo se lee `auth.users`, que sí está permitido.
-- =============================================================================

-- Se recrean desde cero: `create or replace` conservaría el propietario que
-- tuvieran de antes, y una función SECURITY DEFINER que no pertenezca al dueño
-- de las tablas queda sujeta a la RLS y no vería la organización.
drop function if exists app.vincular_usuario(text, app.user_role, text);
drop function if exists app.asegurar_permisos_empleado(uuid);

create function app.vincular_usuario(
  p_email text,
  p_role  app.user_role default 'employee',
  p_nombre text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user     uuid;
  v_meta     jsonb;
  v_org      uuid;
  v_branch   uuid;
  v_nombre   text;
  v_previo   uuid;
begin
  -- 1. La persona tiene que existir en Auth. Si no, hay que crearla primero
  --    desde el panel: Authentication → Users → Add user.
  select u.id, u.raw_user_meta_data
    into v_user, v_meta
    from auth.users u
   where lower(u.email) = lower(btrim(p_email));

  if v_user is null then
    return format('No existe ningún usuario con el correo %s. '
                  'Crealo primero en Authentication → Users → Add user '
                  '(acordate de marcar «Auto Confirm User»).', p_email);
  end if;

  -- 2. Organización y sucursal. Se toma la primera que exista.
  select id into v_org from organizations order by created_at limit 1;
  if v_org is null then
    return 'No hay ninguna organización creada. Cargá primero supabase/seed.sql '
           'o la configuración inicial del negocio.';
  end if;

  select id into v_branch
    from branches
   where organization_id = v_org
   order by created_at
   limit 1;

  -- 3. Nombre: el que se pase por parámetro, si no el de los metadatos de Auth,
  --    y como último recurso la parte del correo anterior a la arroba.
  v_nombre := coalesce(
    nullif(btrim(p_nombre), ''),
    nullif(btrim(coalesce(v_meta ->> 'full_name', v_meta ->> 'name', '')), ''),
    split_part(p_email, '@', 1)
  );

  -- 4. Si había un perfil con ese correo pero otro id (por ejemplo, el que dejó
  --    la semilla demo), se reemplaza por el del usuario real.
  select id into v_previo
    from user_profiles
   where lower(email) = lower(btrim(p_email)) and id <> v_user;

  if v_previo is not null then
    delete from user_profiles where id = v_previo;
  end if;

  insert into user_profiles (id, organization_id, branch_id, full_name, role, email, is_active)
  values (v_user, v_org, v_branch, v_nombre, p_role, btrim(p_email), true)
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        branch_id       = excluded.branch_id,
        full_name       = excluded.full_name,
        role            = excluded.role,
        email           = excluded.email,
        is_active       = true,
        updated_at      = now();

  -- 5. Un empleado necesita su ficha y los permisos de su rol.
  if p_role = 'employee' then
    insert into employee_profiles (organization_id, user_id)
    values (v_org, v_user)
    on conflict (user_id) do nothing;
  end if;

  perform app.asegurar_permisos_empleado(v_org);

  return format('Listo: %s quedó vinculado como %s.',
                p_email,
                case p_role when 'owner' then 'dueño' else 'empleado' end);
end;
$$;

-- -----------------------------------------------------------------------------
-- Permisos del empleado según la sección 5.2 de la especificación.
-- Se cargan si todavía no estaban; no pisa lo que el dueño haya cambiado.
-- -----------------------------------------------------------------------------
create function app.asegurar_permisos_empleado(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into role_permissions (organization_id, role, permission, granted)
  values
    (p_org, 'employee', 'sales.create',        true),
    (p_org, 'employee', 'payments.create',     true),
    (p_org, 'employee', 'customers.manage',    true),
    (p_org, 'employee', 'cash.open',           true),
    (p_org, 'employee', 'cash.close',          true),
    (p_org, 'employee', 'cash.movement',       true),
    (p_org, 'employee', 'stock.transfer',      true),
    (p_org, 'employee', 'stock.online_exit',   true),
    (p_org, 'employee', 'stock.assemble',      true),
    (p_org, 'employee', 'orders.manage',       true),
    (p_org, 'employee', 'fulfillments.manage', true),
    (p_org, 'employee', 'posters.manage',      true),
    -- Explícitamente denegados
    (p_org, 'employee', 'costs.view',        false),
    (p_org, 'employee', 'reports.view',      false),
    (p_org, 'employee', 'catalog.manage',    false),
    (p_org, 'employee', 'prices.manage',     false),
    (p_org, 'employee', 'stock.adjust',      false),
    (p_org, 'employee', 'sales.reverse',     false),
    (p_org, 'employee', 'cash.reopen',       false),
    (p_org, 'employee', 'settings.manage',   false),
    (p_org, 'employee', 'suppliers.manage',  false)
  on conflict do nothing;
end;
$$;
