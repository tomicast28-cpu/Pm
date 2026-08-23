-- =============================================================================
-- 0006 — Clientes, pedidos/ventas, descuentos, pagos, cuenta corriente,
--        cumplimientos, devoluciones, ventas perdidas y facturación manual.
--
-- Estados independientes (principio 4.3): comercial, de pago, de preparación y
-- de entrega no se deducen uno del otro.
-- =============================================================================

create table customers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  code              text,
  name              text not null,
  name_normalized   text generated always as (app.normalize_text(name)) stored,
  customer_type     text not null default 'retail',    -- retail | wholesale
  phone             text,
  whatsapp          text,
  email             text,
  document_type     text,                              -- DNI | CUIT | CUIL
  document_number   text,
  tax_condition     text,
  address           text,
  city              text,
  notes             text,
  price_list_id     uuid references price_lists(id) on delete set null,
  credit_limit      app.money not null default 0,
  credit_enabled    boolean not null default false,
  payment_term_days int not null default 0,
  is_walk_in        boolean not null default false,    -- «Consumidor final»
  is_active         boolean not null default true,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index customers_name_trgm_idx on customers using gin (name_normalized extensions.gin_trgm_ops);
create unique index customers_walkin_uq on customers (organization_id) where is_walk_in;

create type app.order_kind as enum ('sale', 'quote', 'order');

create type app.order_status as enum (
  'draft', 'quote', 'awaiting_confirmation', 'reserved', 'deposit_received',
  'pending_manufacturing', 'pending_customization', 'ready_for_pickup',
  'delivery_scheduled', 'partially_delivered', 'delivered', 'completed', 'cancelled'
);

create type app.payment_status as enum ('unpaid', 'partial', 'paid', 'partially_refunded', 'refunded');

create type app.preparation_status as enum ('not_required', 'pending', 'in_progress', 'waiting_third_party', 'ready');

create type app.fulfillment_status as enum ('not_required', 'pending', 'partial', 'fulfilled');

create table orders (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  branch_id           uuid not null references branches(id) on delete cascade,
  number              text not null,
  kind                app.order_kind not null default 'sale',
  status              app.order_status not null default 'draft',
  payment_status      app.payment_status not null default 'unpaid',
  preparation_status  app.preparation_status not null default 'not_required',
  fulfillment_status  app.fulfillment_status not null default 'not_required',
  customer_id         uuid references customers(id) on delete restrict,
  price_list_id       uuid not null references price_lists(id) on delete restrict,
  channel_id          uuid references sales_channels(id) on delete set null,
  cash_session_id     uuid,
  -- Totales congelados al confirmar.
  subtotal            app.money not null default 0,   -- suma de líneas antes de descuento global
  discount_total      app.money not null default 0,
  shipping_total      app.money not null default 0,
  tax_total           app.money not null default 0,
  total               app.money not null default 0,
  paid_total          app.money not null default 0,
  refunded_total      app.money not null default 0,
  balance_due         app.money generated always as (total - paid_total + refunded_total) stored,
  reserve_stock       boolean not null default false,
  reservation_expires_at timestamptz,
  valid_until         date,                            -- vigencia de presupuesto
  lost_reason         text,
  requires_invoice    boolean not null default false,
  notes               text,
  internal_notes      text,
  confirmed_at        timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  -- Clave de idempotencia: impide que el doble clic en «Cobrar» duplique la venta.
  idempotency_key     text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  is_demo             boolean not null default false,
  unique (organization_id, number)
);
create unique index orders_idempotency_uq on orders (organization_id, idempotency_key)
  where idempotency_key is not null;
create index on orders (organization_id, created_at desc);
create index on orders (customer_id);
create index on orders (status, payment_status);
create index on orders (cash_session_id);

-- Snapshots obligatorios (25.10): la línea conserva lo vendido aunque el catálogo cambie.
create table order_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  order_id          uuid not null references orders(id) on delete cascade,
  variant_id        uuid references product_variants(id) on delete set null,
  line_number       int not null default 1,
  -- Copias congeladas
  sku_snapshot      text not null,
  name_snapshot     text not null,
  is_service        boolean not null default false,
  bundle_mode       text,                              -- null | virtual | stocked
  bundle_config     jsonb,                             -- componentes al momento de vender
  quantity          app.qty not null check (quantity > 0),
  list_price        app.money not null,                -- precio de lista antes de descuento
  discount_amount   app.money not null default 0,
  discount_rate     app.rate not null default 0,
  unit_price        app.money not null,                -- precio final unitario
  tax_rate          app.rate not null default 0.21,
  line_total        app.money not null,
  fulfilled_qty     app.qty not null default 0,
  returned_qty      app.qty not null default 0,
  location_id       uuid references stock_locations(id) on delete set null,
  created_by        uuid,
  created_at        timestamptz not null default now()
);
create index on order_items (order_id);
create index on order_items (variant_id);

-- Costos congelados de la línea. Tabla separada: solo el dueño puede leerla.
create table order_item_costs (
  order_item_id     uuid primary key references order_items(id) on delete cascade,
  organization_id   uuid not null references organizations(id) on delete cascade,
  order_id          uuid not null references orders(id) on delete cascade,
  variant_id        uuid,
  quantity          app.qty not null,
  -- Fotografía al confirmar la venta (9.5).
  last_cost         app.money not null default 0,
  average_cost      app.money not null default 0,
  fifo_cost         app.money not null default 0,      -- costo real de los lotes consumidos
  extra_direct_cost app.money not null default 0,
  created_at        timestamptz not null default now()
);
create index on order_item_costs (order_id);

-- Descuentos auditados (5.2): quién, cuánto, por qué, sobre qué precio.
create table order_discounts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  order_id          uuid not null references orders(id) on delete cascade,
  order_item_id     uuid references order_items(id) on delete cascade,
  scope             text not null default 'line',      -- line | order
  original_price    app.money not null,
  final_price       app.money not null,
  discount_amount   app.money not null,
  discount_rate     app.rate not null,
  reason            text,
  authorized_by     uuid,
  created_by        uuid not null,
  created_at        timestamptz not null default now()
);
create index on order_discounts (order_id);

-- -----------------------------------------------------------------------------
-- Pagos
-- -----------------------------------------------------------------------------
create table payments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  branch_id           uuid not null references branches(id) on delete cascade,
  number              text,
  direction           text not null default 'in',      -- in = cobro | out = reembolso
  payment_method_id   uuid not null references payment_methods(id) on delete restrict,
  customer_id         uuid references customers(id) on delete set null,
  order_id            uuid references orders(id) on delete set null,
  cash_session_id     uuid,
  amount              app.money not null check (amount > 0),
  -- Vuelto entregado en efectivo (no reduce lo imputado al pedido).
  change_given        app.money not null default 0,
  commission_amount   app.money not null default 0,
  net_amount          app.money not null default 0,
  installments        int not null default 1,
  status              text not null default 'confirmed', -- pending | confirmed | rejected | reversed
  settlement_date     date,
  reference           text,
  notes               text,
  reversal_of_id      uuid references payments(id) on delete set null,
  idempotency_key     text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  is_demo             boolean not null default false
);
create unique index payments_idempotency_uq on payments (organization_id, idempotency_key)
  where idempotency_key is not null;
create index on payments (order_id);
create index on payments (cash_session_id);
create index on payments (organization_id, created_at desc);

create table payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  payment_id      uuid not null references payments(id) on delete cascade,
  order_id        uuid not null references orders(id) on delete cascade,
  amount          app.money not null check (amount > 0),
  created_at      timestamptz not null default now()
);
create index on payment_allocations (order_id);

-- Cuenta corriente de clientes: libro de movimientos, no un saldo editable.
create table customer_account_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id     uuid not null references customers(id) on delete cascade,
  entry_type      text not null,       -- sale | payment | credit_note | debit_note | refund
  order_id        uuid references orders(id) on delete set null,
  payment_id      uuid references payments(id) on delete set null,
  -- Positivo = aumenta la deuda del cliente. Negativo = la reduce.
  amount          app.money not null,
  due_date        date,
  description     text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index on customer_account_entries (customer_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Cumplimientos (retiros y entregas), devoluciones
-- -----------------------------------------------------------------------------
create table fulfillments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  order_id        uuid not null references orders(id) on delete cascade,
  number          text not null,
  method          text not null default 'pickup',   -- pickup | delivery
  status          text not null default 'completed',
  delivered_at    timestamptz,
  received_by     text,
  notes           text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create table fulfillment_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  fulfillment_id  uuid not null references fulfillments(id) on delete cascade,
  order_item_id   uuid not null references order_items(id) on delete restrict,
  variant_id      uuid references product_variants(id) on delete set null,
  quantity        app.qty not null check (quantity > 0),
  location_id     uuid references stock_locations(id) on delete set null
);

create table returns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  order_id        uuid references orders(id) on delete set null,
  customer_id     uuid references customers(id) on delete set null,
  number          text not null,
  reason          text,
  resolution      text not null,   -- exchange | refund | credit | repair | none
  total_amount    app.money not null default 0,
  status          text not null default 'completed',
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create table return_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  return_id       uuid not null references returns(id) on delete cascade,
  order_item_id   uuid references order_items(id) on delete set null,
  variant_id      uuid references product_variants(id) on delete set null,
  quantity        app.qty not null check (quantity > 0),
  unit_price      app.money not null default 0,
  condition       text not null default 'resellable', -- resellable | damaged | to_supplier | discard
  destination_location_id uuid references stock_locations(id) on delete set null
);

-- -----------------------------------------------------------------------------
-- Demanda perdida y visitas (22.8 / 22.9)
-- -----------------------------------------------------------------------------
create table lost_sales (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  variant_id      uuid references product_variants(id) on delete set null,
  product_text    text,
  reason          text not null,   -- no_stock | price | size | color | thinking | other
  quantity        app.qty not null default 1,
  notes           text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create table visitor_counts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  counted_on      date not null default current_date,
  visitors        int not null default 0,
  exits_without_purchase int not null default 0,
  updated_at      timestamptz not null default now(),
  unique (branch_id, counted_on)
);

-- Facturación manual del MVP. La emisión real es externa; la interfaz
-- `FiscalProvider` de la aplicación permitirá enchufar ARCA sin tocar ventas.
create table manual_invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  order_id        uuid not null references orders(id) on delete cascade,
  invoice_type    text,             -- A | B | C
  document_type   text,
  document_number text,
  legal_name      text,
  status          text not null default 'pending',  -- pending | issued | cancelled
  number          text,
  issued_at       date,
  file_path       text,
  created_at      timestamptz not null default now()
);

create table attachments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  entity          text not null,
  entity_id       uuid not null,
  storage_path    text not null,
  file_name       text,
  mime_type       text,
  size_bytes      bigint,
  uploaded_by     uuid,
  created_at      timestamptz not null default now()
);
create index on attachments (entity, entity_id);
