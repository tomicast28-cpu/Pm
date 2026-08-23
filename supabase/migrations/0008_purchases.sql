-- =============================================================================
-- 0008 — Proveedores y compras. (Modelo completo; funciones en fase 3.)
-- =============================================================================

create table suppliers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  name              text not null,
  name_normalized   text generated always as (app.normalize_text(name)) stored,
  legal_name        text,
  tax_id            text,
  contact_name      text,
  phone             text,
  whatsapp          text,
  email             text,
  address           text,
  bank_cbu          text,
  bank_alias        text,
  payment_terms     text,
  lead_time_days    int,
  notes             text,
  is_active         boolean not null default true,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now()
);

create table supplier_products (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  supplier_id     uuid not null references suppliers(id) on delete cascade,
  variant_id      uuid not null references product_variants(id) on delete cascade,
  supplier_sku    text,
  last_cost       app.money,
  lead_time_days  int,
  is_primary      boolean not null default false,
  unique (supplier_id, variant_id)
);

create table product_suppliers (
  product_id      uuid not null references products(id) on delete cascade,
  supplier_id     uuid not null references suppliers(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  is_primary      boolean not null default false,
  primary key (product_id, supplier_id)
);

create table purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  supplier_id     uuid not null references suppliers(id) on delete restrict,
  number          text not null,
  status          text not null default 'draft',  -- draft | sent | partially_received | received | cancelled
  expected_at     date,
  notes           text,
  total_estimated app.money not null default 0,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (organization_id, number)
);

create table purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  variant_id        uuid not null references product_variants(id) on delete restrict,
  quantity          app.qty not null check (quantity > 0),
  received_qty      app.qty not null default 0,
  unit_cost         app.money not null default 0
);

create table goods_receipts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid not null references branches(id) on delete cascade,
  supplier_id       uuid not null references suppliers(id) on delete restrict,
  purchase_order_id uuid references purchase_orders(id) on delete set null,
  number            text not null,
  document_number   text,
  received_on       date not null default current_date,
  location_id       uuid not null references stock_locations(id) on delete restrict,
  subtotal          app.money not null default 0,
  total             app.money not null default 0,
  paid_total        app.money not null default 0,
  due_date          date,
  status            text not null default 'received',  -- draft | received | cancelled
  update_costs      boolean not null default true,
  notes             text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  is_demo           boolean not null default false,
  unique (organization_id, number)
);

create table goods_receipt_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  receipt_id        uuid not null references goods_receipts(id) on delete cascade,
  variant_id        uuid not null references product_variants(id) on delete restrict,
  quantity_ordered  app.qty,
  quantity_received app.qty not null check (quantity_received >= 0),
  quantity_damaged  app.qty not null default 0,
  unit_cost         app.money not null default 0,
  previous_cost     app.money,
  lot_id            uuid references inventory_lots(id) on delete set null,
  location_id       uuid references stock_locations(id) on delete set null
);

create table supplier_account_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  supplier_id     uuid not null references suppliers(id) on delete cascade,
  entry_type      text not null,  -- purchase | payment | credit_note | debit_note
  receipt_id      uuid references goods_receipts(id) on delete set null,
  payment_id      uuid,
  -- Positivo = aumenta lo que se le debe al proveedor.
  amount          app.money not null,
  due_date        date,
  description     text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index on supplier_account_entries (supplier_id, created_at desc);

create table supplier_payments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid not null references branches(id) on delete cascade,
  supplier_id       uuid not null references suppliers(id) on delete restrict,
  payment_method_id uuid references payment_methods(id) on delete set null,
  session_id        uuid references cash_sessions(id) on delete set null,
  amount            app.money not null check (amount > 0),
  paid_on           date not null default current_date,
  reference         text,
  notes             text,
  created_by        uuid,
  created_at        timestamptz not null default now()
);

create table supplier_incidents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  supplier_id     uuid not null references suppliers(id) on delete cascade,
  receipt_id      uuid references goods_receipts(id) on delete set null,
  incident_type   text not null,  -- shortage | damaged | cost_diff | return | credit_note | delay
  description     text,
  resolution      text,
  resolved_at     timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create table supplier_returns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  supplier_id     uuid not null references suppliers(id) on delete cascade,
  variant_id      uuid references product_variants(id) on delete set null,
  quantity        app.qty not null check (quantity > 0),
  unit_cost       app.money not null default 0,
  reason          text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
