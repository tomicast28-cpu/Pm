-- =============================================================================
-- 0005 — Inventario: lotes, libro de movimientos, saldos y reservas.
--
-- `inventory_movements` (+ items) es la fuente histórica inmutable.
-- `inventory_balances` es una proyección transaccional optimizada para lectura:
-- solo la escriben las funciones de dominio, nunca la interfaz.
-- =============================================================================

create type app.movement_type as enum (
  'purchase_receipt',      -- ingreso por compra
  'sale',                  -- venta
  'reservation',           -- reserva (no toca físico)
  'reservation_release',   -- liberación de reserva
  'fulfillment',           -- entrega de reserva
  'online_sale_exit',      -- salida por venta de ecommerce
  'transfer',              -- transferencia interna
  'adjustment_in',
  'adjustment_out',
  'damage',
  'damage_recovery',
  'customer_return',
  'supplier_return',
  'bundle_assemble',
  'bundle_disassemble',
  'initial_inventory',
  'reversal'
);

create type app.stock_state as enum ('available', 'damaged', 'display', 'in_transit', 'pending_receipt');

-- -----------------------------------------------------------------------------
-- Lotes: cada ingreso genera uno. Las salidas consumen por FIFO.
-- Contienen costo unitario => acceso restringido al dueño.
-- -----------------------------------------------------------------------------
create table inventory_lots (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid not null references branches(id) on delete cascade,
  variant_id        uuid not null references product_variants(id) on delete cascade,
  location_id       uuid not null references stock_locations(id) on delete restrict,
  received_at       timestamptz not null default now(),
  original_quantity app.qty not null check (original_quantity > 0),
  remaining_quantity app.qty not null check (remaining_quantity >= 0),
  unit_cost         app.money not null default 0,
  supplier_id       uuid,
  purchase_id       uuid,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  constraint lot_remaining_le_original_ck check (remaining_quantity <= original_quantity)
);
create index inventory_lots_fifo_idx on inventory_lots (variant_id, location_id, received_at, id)
  where remaining_quantity > 0;

-- -----------------------------------------------------------------------------
-- Libro de movimientos
-- -----------------------------------------------------------------------------
create table inventory_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  movement_type   app.movement_type not null,
  reference_type  text,        -- 'order' | 'purchase' | 'count' | 'transfer' | ...
  reference_id    uuid,
  reversal_of_id  uuid references inventory_movements(id) on delete set null,
  reason          text,
  notes           text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  is_demo         boolean not null default false
);
create index on inventory_movements (organization_id, created_at desc);
create index on inventory_movements (reference_type, reference_id);

create table inventory_movement_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  movement_id         uuid not null references inventory_movements(id) on delete cascade,
  variant_id          uuid not null references product_variants(id) on delete restrict,
  from_location_id    uuid references stock_locations(id) on delete restrict,
  to_location_id      uuid references stock_locations(id) on delete restrict,
  from_state          app.stock_state,
  to_state            app.stock_state,
  quantity            app.qty not null check (quantity > 0),
  unit_cost           app.money,       -- costo del lote consumido/ingresado
  lot_id              uuid references inventory_lots(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index on inventory_movement_items (movement_id);
create index on inventory_movement_items (variant_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Saldos por SKU / ubicación / estado
-- -----------------------------------------------------------------------------
create table inventory_balances (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  variant_id      uuid not null references product_variants(id) on delete cascade,
  location_id     uuid not null references stock_locations(id) on delete cascade,
  state           app.stock_state not null default 'available',
  -- Físico presente en la ubicación.
  on_hand         app.qty not null default 0,
  -- Comprometido por señas/reservas. Disponible = on_hand - reserved.
  reserved        app.qty not null default 0,
  updated_at      timestamptz not null default now(),
  unique (variant_id, location_id, state),
  constraint balance_reserved_nonneg_ck check (reserved >= 0)
);
create index on inventory_balances (organization_id, variant_id);

-- Disponible para vender: físico menos reservado, en ubicaciones vendibles.
create or replace function app.available_qty(p_variant uuid, p_location uuid default null)
returns app.qty
language sql
stable
as $$
  select coalesce(sum(b.on_hand - b.reserved), 0)::app.qty
    from inventory_balances b
    join stock_locations l on l.id = b.location_id
   where b.variant_id = p_variant
     and b.state = 'available'
     and l.sellable
     and (p_location is null or b.location_id = p_location)
$$;

create or replace function app.on_hand_qty(p_variant uuid, p_location uuid default null)
returns app.qty
language sql
stable
as $$
  select coalesce(sum(b.on_hand), 0)::app.qty
    from inventory_balances b
   where b.variant_id = p_variant
     and b.state = 'available'
     and (p_location is null or b.location_id = p_location)
$$;

-- -----------------------------------------------------------------------------
-- Reservas
-- -----------------------------------------------------------------------------
create table stock_reservations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  order_id        uuid,
  order_item_id   uuid,
  variant_id      uuid not null references product_variants(id) on delete restrict,
  location_id     uuid not null references stock_locations(id) on delete restrict,
  quantity        app.qty not null check (quantity > 0),
  consumed_qty    app.qty not null default 0,
  released_qty    app.qty not null default 0,
  status          text not null default 'active',   -- active | consumed | released | expired
  expires_at      timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  constraint reservation_qty_ck check (consumed_qty + released_qty <= quantity)
);
create index on stock_reservations (order_id);
create index on stock_reservations (variant_id, status);

-- -----------------------------------------------------------------------------
-- Inventario físico
-- -----------------------------------------------------------------------------
create table inventory_counts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  location_id     uuid references stock_locations(id) on delete set null,
  category_id     uuid references categories(id) on delete set null,
  code            text not null,
  scope           text not null default 'full',      -- full | partial | cyclic
  status          text not null default 'draft',     -- draft | counting | review | approved | cancelled
  frozen_at       timestamptz,
  approved_at     timestamptz,
  approved_by     uuid,
  notes           text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create table inventory_count_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  count_id        uuid not null references inventory_counts(id) on delete cascade,
  variant_id      uuid not null references product_variants(id) on delete restrict,
  location_id     uuid not null references stock_locations(id) on delete restrict,
  -- Fotografía del stock teórico al congelar el conteo.
  expected_qty    app.qty not null default 0,
  counted_qty     app.qty,
  difference_qty  app.qty generated always as (coalesce(counted_qty, 0) - expected_qty) stored,
  reason          text,
  counted_by      uuid,
  counted_at      timestamptz,
  unique (count_id, variant_id, location_id)
);
