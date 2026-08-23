-- =============================================================================
-- 0001 — Base técnica: extensiones, esquema `app`, helpers de sesión, auditoría.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";
create extension if not exists "pg_trgm";

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

-- auth.uid() lee el claim `sub` del JWT que Supabase deja en `request.jwt.claims`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

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
  select lower(public.unaccent('public.unaccent'::regdictionary, coalesce(p, '')))
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
