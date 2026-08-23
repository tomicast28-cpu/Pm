-- =============================================================================
-- 0002 — Organización, sucursales, ubicaciones, configuración, usuarios y roles.
-- =============================================================================

create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  legal_name    text,
  tax_id        text,
  currency      text not null default 'ARS',
  timezone      text not null default 'America/Argentina/Buenos_Aires',
  locale        text not null default 'es-AR',
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now()
);

create table branches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  address         text,
  phone           text,
  is_active       boolean not null default true,
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table stock_locations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  code            text not null,
  name            text not null,
  -- `sellable`: si el stock de esta ubicación cuenta como disponible para vender.
  sellable        boolean not null default true,
  is_default      boolean not null default false,
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (branch_id, code)
);

-- -----------------------------------------------------------------------------
-- Usuarios
-- -----------------------------------------------------------------------------
create table user_profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  organization_id  uuid not null references organizations(id) on delete cascade,
  branch_id        uuid references branches(id) on delete set null,
  full_name        text not null,
  role             app.user_role not null default 'employee',
  email            text,
  phone            text,
  is_active        boolean not null default true,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on user_profiles (organization_id);

create table employee_profiles (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  user_id           uuid not null unique references user_profiles(id) on delete cascade,
  hired_at          date,
  document_number   text,
  -- Límite de descuento. NULL = sin límite (default inicial de la especificación:
  -- el empleado puede descontar, pero queda auditado).
  max_discount_rate app.rate,
  notes             text,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now()
);

-- Permisos explícitos que amplían el rol base. `granted = false` los revoca.
create table role_permissions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  role            app.user_role,
  user_id         uuid references user_profiles(id) on delete cascade,
  permission      text not null,
  granted         boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint role_permissions_target_ck check (num_nonnulls(role, user_id) = 1)
);
create unique index role_permissions_role_uq on role_permissions (organization_id, role, permission) where user_id is null;
create unique index role_permissions_user_uq on role_permissions (organization_id, user_id, permission) where role is null;

-- -----------------------------------------------------------------------------
-- Helpers de sesión. SECURITY DEFINER + search_path fijo para que las políticas
-- RLS no entren en recursión al consultar user_profiles.
-- -----------------------------------------------------------------------------
create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$ select auth.uid() $$;

create or replace function app.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select organization_id from user_profiles where id = auth.uid() and is_active
$$;

create or replace function app.current_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select branch_id from user_profiles where id = auth.uid() and is_active
$$;

create or replace function app.current_role()
returns app.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from user_profiles where id = auth.uid() and is_active
$$;

create or replace function app.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role = 'owner' from user_profiles where id = auth.uid() and is_active),
    false
  )
$$;

create or replace function app.is_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from user_profiles where id = auth.uid() and is_active)
$$;

-- Permiso efectivo: el dueño tiene todo; el empleado, lo otorgado explícitamente.
create or replace function app.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when app.is_owner() then true
    else coalesce(
      (
        select rp.granted
        from role_permissions rp
        where rp.organization_id = app.current_org_id()
          and rp.permission = p_permission
          and (rp.user_id = auth.uid() or (rp.user_id is null and rp.role = app.current_role()))
        order by rp.user_id nulls last   -- el permiso por usuario gana sobre el del rol
        limit 1
      ),
      false
    )
  end
$$;

-- Falla ruidosamente. La usan las funciones transaccionales antes de escribir.
create or replace function app.require(p_condition boolean, p_message text)
returns void
language plpgsql
immutable
as $$
begin
  if p_condition is not true then
    raise exception '%', p_message using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function app.require_owner()
returns void
language plpgsql
stable
as $$
begin
  if not app.is_owner() then
    raise exception 'Se requieren permisos de dueño para esta operación'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function app.require_permission(p_permission text)
returns void
language plpgsql
stable
as $$
begin
  if not app.has_permission(p_permission) then
    raise exception 'Permiso denegado: %', p_permission
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;
