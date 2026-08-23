-- =============================================================================
-- 0007 — Caja: registradoras, sesiones, movimientos, cierre y gastos.
-- =============================================================================

create table cash_registers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  name            text not null,
  is_active       boolean not null default true,
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (branch_id, name)
);

create table cash_sessions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid not null references branches(id) on delete cascade,
  register_id       uuid not null references cash_registers(id) on delete restrict,
  number            text not null,
  status            text not null default 'open',   -- open | closed
  opening_amount    app.money not null default 0,
  opened_at         timestamptz not null default now(),
  opened_by         uuid,
  closed_at         timestamptz,
  closed_by         uuid,
  -- Totales congelados al cerrar.
  expected_cash     app.money,
  declared_cash     app.money,
  cash_difference   app.money,
  close_notes       text,
  reopened_count    int not null default 0,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (organization_id, number)
);
-- Una sola sesión abierta por caja (criterio de aceptación 16).
create unique index cash_sessions_one_open_uq on cash_sessions (register_id) where status = 'open';
create index on cash_sessions (branch_id, opened_at desc);

create table cash_movements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid not null references branches(id) on delete cascade,
  session_id        uuid not null references cash_sessions(id) on delete cascade,
  movement_type     text not null,   -- opening | sale | refund | income | withdrawal | expense | supplier_payment | adjustment
  payment_method_id uuid references payment_methods(id) on delete set null,
  payment_id        uuid references payments(id) on delete set null,
  order_id          uuid references orders(id) on delete set null,
  -- Positivo = entra dinero. Negativo = sale.
  amount            app.money not null,
  -- Solo los movimientos con `affects_drawer` mueven el efectivo físico.
  affects_drawer    boolean not null default false,
  description       text,
  reason            text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  is_demo           boolean not null default false
);
create index on cash_movements (session_id);
create index on cash_movements (organization_id, created_at desc);

-- Detalle esperado vs declarado por medio de pago al cerrar.
create table cash_close_breakdowns (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  session_id        uuid not null references cash_sessions(id) on delete cascade,
  payment_method_id uuid references payment_methods(id) on delete set null,
  label             text not null,
  expected_amount   app.money not null default 0,
  declared_amount   app.money not null default 0,
  difference        app.money not null default 0,
  reason            text,
  -- Versión de cierre: una reapertura conserva la versión original.
  close_version     int not null default 1,
  created_at        timestamptz not null default now(),
  unique (session_id, payment_method_id, close_version)
);

create table expense_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  is_active       boolean not null default true,
  is_demo         boolean not null default false,
  unique (organization_id, name)
);

create table expenses (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid not null references branches(id) on delete cascade,
  category_id       uuid references expense_categories(id) on delete set null,
  session_id        uuid references cash_sessions(id) on delete set null,
  payment_method_id uuid references payment_methods(id) on delete set null,
  supplier_id       uuid,
  description       text not null,
  amount            app.money not null check (amount > 0),
  spent_on          date not null default current_date,
  receipt_path      text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  is_demo           boolean not null default false
);
create index on expenses (organization_id, spent_on desc);
