-- =============================================================================
-- 0004 — Catálogo: categorías, productos, variantes, combos, listas de precio.
--
-- Decisión de diseño: los costos NO viven en `product_variants`. RLS es por fila,
-- no por columna, así que los costos se aíslan en `variant_costs` y `cost_history`
-- (y `inventory_lots`), tablas cuya política solo admite al dueño. Así el empleado
-- no puede leer costos ni márgenes ni siquiera consultando la API directamente.
-- =============================================================================

create table categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  parent_id       uuid references categories(id) on delete set null,
  name            text not null,
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (organization_id, parent_id, name)
);

create type app.product_kind as enum ('simple', 'variant', 'service', 'bundle_virtual', 'bundle_stocked');

create table products (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  category_id           uuid references categories(id) on delete set null,
  kind                  app.product_kind not null default 'simple',
  name                  text not null,
  name_normalized       text generated always as (app.normalize_text(name)) stored,
  short_description     text,
  long_description      text,
  brand                 text,
  tags                  text[] not null default '{}',
  -- Servicios (envío, grabado) no descuentan stock.
  is_inventoried        boolean not null default true,
  visible_in_pos        boolean not null default true,
  requires_customization boolean not null default false,
  is_handcrafted        boolean not null default false,
  notes                 text,
  is_active             boolean not null default true,
  is_demo               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on products (organization_id, is_active);
create index products_name_trgm_idx on products using gin (name_normalized gin_trgm_ops);

create table product_variants (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  product_id          uuid not null references products(id) on delete cascade,
  sku                 text not null,
  barcode             text,
  name                text not null,              -- «Negro 30x20x15»
  name_normalized     text generated always as (app.normalize_text(name)) stored,
  -- Atributos flexibles: {"color":"Negro","medida":"30x20x15","material":"Zuncho"}
  attributes          jsonb not null default '{}'::jsonb,
  unit                text not null default 'unidad',
  min_stock           app.qty not null default 0,
  weight_kg           numeric(10,3),
  dimensions          text,
  preferred_location_id uuid references stock_locations(id) on delete set null,
  allows_backorder    boolean not null default false,
  -- Vender sin stock requiere autorización del dueño en cada operación.
  allows_oversell     boolean not null default false,
  is_active           boolean not null default true,
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, sku)
);
create index on product_variants (product_id);
create index product_variants_sku_trgm_idx on product_variants using gin (sku gin_trgm_ops);
create unique index product_variants_barcode_uq on product_variants (organization_id, barcode) where barcode is not null;

create table product_images (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id      uuid not null references products(id) on delete cascade,
  variant_id      uuid references product_variants(id) on delete cascade,
  storage_path    text not null,
  alt_text        text,
  sort_order      int not null default 0,
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Combos. `bundle_variant_id` es la variante que representa el combo;
-- `component_variant_id` es cada pieza que lo integra.
-- -----------------------------------------------------------------------------
create table bundle_components (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  bundle_variant_id     uuid not null references product_variants(id) on delete cascade,
  component_variant_id  uuid not null references product_variants(id) on delete restrict,
  quantity              app.qty not null check (quantity > 0),
  -- Sustituciones permitidas para esta posición del combo.
  substitutes           uuid[] not null default '{}',
  sort_order            int not null default 0,
  unique (bundle_variant_id, component_variant_id),
  constraint bundle_no_self_reference_ck check (bundle_variant_id <> component_variant_id)
);
create index on bundle_components (component_variant_id);

-- -----------------------------------------------------------------------------
-- Precios
-- -----------------------------------------------------------------------------
create table price_lists (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  code              text not null,
  name              text not null,
  -- Una lista puede derivarse de otra por porcentaje en lugar de tener precio fijo.
  derived_from_id   uuid references price_lists(id) on delete set null,
  adjustment_rate   app.rate not null default 0,      -- -0.10 = 10% menos
  rounding          text not null default 'none',
  valid_from        date,
  valid_to          date,
  is_default        boolean not null default false,
  is_wholesale      boolean not null default false,
  sort_order        int not null default 0,
  is_active         boolean not null default true,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (organization_id, code)
);

create table variant_prices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  variant_id      uuid not null references product_variants(id) on delete cascade,
  price_list_id   uuid not null references price_lists(id) on delete cascade,
  price           app.money not null check (price >= 0),   -- IVA incluido
  tax_rate        app.rate not null default 0.21,
  updated_at      timestamptz not null default now(),
  unique (variant_id, price_list_id)
);

create table price_history (
  id              bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  variant_id      uuid not null references product_variants(id) on delete cascade,
  price_list_id   uuid not null references price_lists(id) on delete cascade,
  old_price       app.money,
  new_price       app.money not null,
  reason          text,
  changed_by      uuid,
  created_at      timestamptz not null default now()
);
create index on price_history (variant_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Costos — acceso restringido al dueño (ver 0010_rls.sql)
-- -----------------------------------------------------------------------------
create table variant_costs (
  variant_id        uuid primary key references product_variants(id) on delete cascade,
  organization_id   uuid not null references organizations(id) on delete cascade,
  last_cost         app.money not null default 0,   -- último costo de reposición, IVA incluido
  average_cost      app.money not null default 0,   -- costo promedio ponderado
  last_cost_at      timestamptz,
  last_supplier_id  uuid,
  extra_direct_cost app.money not null default 0,
  updated_at        timestamptz not null default now()
);

create table cost_history (
  id                bigserial primary key,
  organization_id   uuid not null references organizations(id) on delete cascade,
  variant_id        uuid not null references product_variants(id) on delete cascade,
  old_cost          app.money,
  new_cost          app.money not null,
  old_average_cost  app.money,
  new_average_cost  app.money,
  source            text not null default 'manual',   -- manual | purchase | import
  reference_id      uuid,
  supplier_id       uuid,
  reason            text,
  changed_by        uuid,
  created_at        timestamptz not null default now()
);
create index on cost_history (variant_id, created_at desc);

-- Toda variante tiene su fila de costos desde el alta, aunque valga cero.
create or replace function app.tg_variant_costs_bootstrap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into variant_costs (variant_id, organization_id)
  values (new.id, new.organization_id)
  on conflict (variant_id) do nothing;
  return new;
end;
$$;

create trigger variant_costs_bootstrap
after insert on product_variants
for each row execute function app.tg_variant_costs_bootstrap();

-- -----------------------------------------------------------------------------
-- Precio efectivo de una lista, resolviendo listas derivadas.
-- -----------------------------------------------------------------------------
create or replace function app.effective_price(p_variant uuid, p_price_list uuid)
returns app.money
language plpgsql
stable
as $$
declare
  v_price app.money;
  v_list  record;
begin
  select * into v_list from price_lists where id = p_price_list;
  if not found then
    raise exception 'Lista de precios inexistente' using errcode = 'no_data_found';
  end if;

  select price into v_price
    from variant_prices
   where variant_id = p_variant and price_list_id = p_price_list;

  if v_price is not null then
    return v_price;
  end if;

  if v_list.derived_from_id is not null then
    v_price := app.effective_price(p_variant, v_list.derived_from_id);
    if v_price is null then
      return null;
    end if;
    return app.round_price(v_price * (1 + v_list.adjustment_rate), v_list.rounding);
  end if;

  return null;
end;
$$;
