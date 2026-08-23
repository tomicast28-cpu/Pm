-- =============================================================================
-- 0009 — Entregas, empleados (módulo laboral), y tablas de sistema.
-- =============================================================================

create table delivery_zones (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  suggested_fee   app.money not null default 0,
  estimated_cost  app.money not null default 0,
  notes           text,
  is_active       boolean not null default true,
  is_demo         boolean not null default false,
  unique (organization_id, name)
);

create table deliveries (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid not null references branches(id) on delete cascade,
  order_id          uuid not null references orders(id) on delete cascade,
  fulfillment_id    uuid references fulfillments(id) on delete set null,
  zone_id           uuid references delivery_zones(id) on delete set null,
  number            text not null,
  mode              text not null default 'own',   -- own | courier
  status            text not null default 'unscheduled',
  courier_name      text,
  contact_name      text,
  phone             text,
  address           text,
  map_url           text,
  scheduled_for     date,
  time_window       text,
  -- Economía del envío (9.5: «envío absorbido»).
  charged_amount    app.money not null default 0,
  actual_cost       app.money not null default 0,
  -- Cobro por fletero (15.4).
  collected_by_courier app.money not null default 0,
  settled_amount    app.money not null default 0,
  proof_path        text,
  notes             text,
  delivered_at      timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  unique (organization_id, number)
);

create table delivery_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  delivery_id     uuid not null references deliveries(id) on delete cascade,
  order_item_id   uuid references order_items(id) on delete set null,
  variant_id      uuid references product_variants(id) on delete set null,
  quantity_prepared app.qty not null default 0,
  quantity_delivered app.qty not null default 0
);

create table courier_settlements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid not null references branches(id) on delete cascade,
  courier_name      text not null,
  payment_method_id uuid references payment_methods(id) on delete set null,
  session_id        uuid references cash_sessions(id) on delete set null,
  amount            app.money not null,
  difference        app.money not null default 0,
  settled_on        date not null default current_date,
  notes             text,
  created_by        uuid,
  created_at        timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Módulo laboral (fase 5). Administrativo: no sustituye una liquidación legal.
-- -----------------------------------------------------------------------------
create table employee_time_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references user_profiles(id) on delete cascade,
  checked_in_at   timestamptz not null,
  checked_out_at  timestamptz,
  notes           text,
  created_at      timestamptz not null default now()
);

create table employee_tasks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id) on delete cascade,
  assigned_to     uuid references user_profiles(id) on delete set null,
  title           text not null,
  description     text,
  due_date        date,
  status          text not null default 'pending',  -- pending | done | cancelled
  completed_at    timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create table employee_advances (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references user_profiles(id) on delete cascade,
  session_id      uuid references cash_sessions(id) on delete set null,
  amount          app.money not null check (amount > 0),
  granted_on      date not null default current_date,
  notes           text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create table employee_commissions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references user_profiles(id) on delete cascade,
  order_id        uuid references orders(id) on delete set null,
  period_start    date,
  period_end      date,
  base_amount     app.money not null default 0,
  rate            app.rate not null default 0,
  amount          app.money not null default 0,
  status          text not null default 'pending',
  created_at      timestamptz not null default now()
);

create table payroll_payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references user_profiles(id) on delete cascade,
  period          text not null,
  gross_amount    app.money not null default 0,
  advances_amount app.money not null default 0,
  net_amount      app.money not null default 0,
  paid_on         date,
  notes           text,
  created_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Sistema
-- -----------------------------------------------------------------------------
create table notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id) on delete cascade,
  user_id         uuid references user_profiles(id) on delete cascade,   -- null = para todos
  -- Solo el dueño ve las notificaciones marcadas como confidenciales.
  owner_only      boolean not null default false,
  priority        text not null default 'normal',   -- low | normal | high
  kind            text not null,
  title           text not null,
  body            text,
  action_url      text,
  entity          text,
  entity_id       uuid,
  status          text not null default 'unread',   -- unread | read | resolved | snoozed | dismissed
  snoozed_until   timestamptz,
  dismiss_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on notifications (organization_id, status, created_at desc);

create table import_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind            text not null,       -- catalog | supplier_prices | stock
  file_name       text,
  storage_path    text,
  status          text not null default 'pending',  -- pending | validated | applied | reverted | failed
  total_rows      int not null default 0,
  valid_rows      int not null default 0,
  error_rows      int not null default 0,
  applied_rows    int not null default 0,
  summary         jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  applied_at      timestamptz,
  reverted_at     timestamptz
);

create table import_job_rows (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id          uuid not null references import_jobs(id) on delete cascade,
  row_number      int not null,
  raw_data        jsonb not null,
  status          text not null default 'pending',  -- pending | valid | error | applied | skipped
  errors          text[],
  created_entity  text,
  created_id      uuid
);
create index on import_job_rows (job_id, status);

create table report_snapshots (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id) on delete cascade,
  kind            text not null,     -- daily_summary | monthly_summary | abc | aging
  period_start    date not null,
  period_end      date not null,
  data            jsonb not null,
  generated_at    timestamptz not null default now(),
  unique (organization_id, kind, period_start, period_end)
);

create table poster_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  code            text not null,
  name            text not null,
  description     text,
  -- Configuración declarativa del SVG determinista.
  config          jsonb not null default '{}'::jsonb,
  is_system       boolean not null default false,
  sort_order      int not null default 0
);
create unique index poster_templates_code_uq on poster_templates (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

create table posters (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  template_id     uuid references poster_templates(id) on delete set null,
  variant_id      uuid references product_variants(id) on delete set null,
  name            text not null,
  format          text not null default 'a4',   -- a4 | a5 | labels_a4 | window | square | portrait | story
  data            jsonb not null default '{}'::jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
