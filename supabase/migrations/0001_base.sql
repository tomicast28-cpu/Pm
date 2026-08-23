-- =============================================================================
-- 0001 — Base técnica: extensiones, esquema `app`, helpers de sesión, auditoría.
-- =============================================================================

-- Supabase alojado instala las extensiones en el esquema `extensions`; una
-- PostgreSQL limpia las pondría en `public`. Se fuerza `extensions` en ambos
-- casos para que el resto de las migraciones pueda calificarlas siempre igual.
create schema if not exists extensions;

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "unaccent" with schema extensions;
create extension if not exists "pg_trgm" with schema extensions;

-- En Supabase este permiso ya viene dado; en una instalación limpia hay que
-- otorgarlo o las columnas generadas que normalizan texto fallan al escribir.
grant usage on schema extensions to public;

create schema if not exists app;

-- -----------------------------------------------------------------------------
-- Compatibilidad local: en Supabase estos roles y el esquema `auth` ya existen.
-- Se crean condicionalmente para que las migraciones corran también en una
-- PostgreSQL limpia (CI y desarrollo local sin Docker).
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'auth' and tablename = 'users') then
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique,
      encrypted_password text,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  end if;
end $$;

-- auth.uid() lee el claim `sub` del JWT. En Supabase ya existe y pertenece a
-- `supabase_auth_admin`: intentar reemplazarla fallaría por permisos, así que
-- solo se crea cuando no está (PostgreSQL local y CI).
do $$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $fn$
      create function auth.uid()
      returns uuid
      language sql
      stable
      as $body$
        select nullif(
          coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
          ),
          ''
        )::uuid
      $body$;
    $fn$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Tipos de dominio
-- -----------------------------------------------------------------------------
create domain app.money as numeric(14,2);
create domain app.qty   as numeric(14,3);
create domain app.rate  as numeric(9,6);   -- porcentajes expresados como 0.2100

create type app.user_role as enum ('owner', 'employee');

-- -----------------------------------------------------------------------------
-- Normalización de texto para búsqueda rápida en el punto de venta.
-- -----------------------------------------------------------------------------
create or replace function app.normalize_text(p text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, '')))
$$;

-- -----------------------------------------------------------------------------
-- Redondeo comercial: los precios se redondean con reglas configurables.
-- -----------------------------------------------------------------------------
create or replace function app.round_price(p_value numeric, p_mode text)
returns numeric
language plpgsql
immutable
as $$
declare
  v numeric := coalesce(p_value, 0);
begin
  return case coalesce(p_mode, 'none')
    when 'none'  then round(v, 2)
    when 'unit'  then round(v, 0)
    when 'ten'   then round(v / 10) * 10
    when 'hundred' then round(v / 100) * 100
    when 'five_hundred' then round(v / 500) * 500
    when 'ending_990' then
      -- Redondea al valor terminado en 990 más cercano (990, 1.990, 2.990, ...).
      greatest(990, round((v - 990) / 1000) * 1000 + 990)
    else round(v, 2)
  end;
end;
$$;
