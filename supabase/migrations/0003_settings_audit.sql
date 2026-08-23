-- =============================================================================
-- 0003 — Configuración del negocio, marca, secuencias, medios de pago,
--        canales de venta y auditoría.
-- =============================================================================

create table business_settings (
  organization_id           uuid primary key references organizations(id) on delete cascade,
  -- Impuestos y precios
  prices_include_tax        boolean not null default true,
  default_tax_rate          app.rate not null default 0.21,
  transfer_discount_rate    app.rate not null default 0.10,
  price_rounding            text not null default 'ten',
  -- Stock
  allow_negative_stock      boolean not null default false,
  low_stock_alert           boolean not null default true,
  aging_buckets_days        int[] not null default '{30,60,90,180}',
  -- Reservas
  reservation_hours         int not null default 48,
  auto_release_reservations boolean not null default false,
  -- Presupuestos
  quote_validity_days       int not null default 7,
  -- Cuenta corriente
  block_on_overdue          boolean not null default true,
  overdue_grace_days        int not null default 0,
  -- Mayorista
  wholesale_min_amount      app.money,
  wholesale_min_units       app.qty,
  -- Comercial
  visitor_counter_enabled   boolean not null default false,
  min_margin_rate           app.rate not null default 0.20,
  cost_increase_alert_rate  app.rate not null default 0.15,
  -- Textos de comprobante
  receipt_exchange_policy   text not null default 'Cambios dentro de los 10 días con ticket. Productos personalizados no tienen cambio.',
  receipt_deposit_policy    text not null default 'Las señas se mantienen 48 horas. Vencido el plazo, la reserva puede liberarse.',
  receipt_pickup_policy     text not null default 'Retiro en local dentro del horario comercial presentando el comprobante.',
  receipt_wood_notice       text not null default 'La madera es un material natural: vetas, tonos y nudos varían entre piezas. No constituye defecto.',
  receipt_footer            text,
  updated_at                timestamptz not null default now()
);

create table brand_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  logo_url        text,
  color_primary   text not null default '#7A4B2A',
  color_accent    text not null default '#D94F30',
  color_dark      text not null default '#2B2118',
  color_light     text not null default '#F5EFE6',
  font_heading    text not null default 'system-ui',
  font_body       text not null default 'system-ui',
  phone           text,
  whatsapp        text,
  instagram       text,
  address         text,
  legal_text      text,
  updated_at      timestamptz not null default now()
);

-- Numeración de documentos (SKU, ventas, presupuestos, remitos, ...).
create table document_sequences (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id) on delete cascade,
  kind            text not null,
  prefix          text not null default '',
  padding         int not null default 6,
  next_value      bigint not null default 1,
  unique (organization_id, branch_id, kind)
);

-- Consume un número de forma atómica. El UPDATE ... RETURNING bloquea la fila,
-- de modo que dos ventas concurrentes nunca reciben el mismo número.
create or replace function app.next_document_number(
  p_org uuid,
  p_kind text,
  p_branch uuid default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_padding int;
  v_value bigint;
begin
  update document_sequences
     set next_value = next_value + 1
   where organization_id = p_org
     and kind = p_kind
     and branch_id is not distinct from p_branch
  returning prefix, padding, next_value - 1 into v_prefix, v_padding, v_value;

  if not found then
    insert into document_sequences (organization_id, branch_id, kind, next_value)
    values (p_org, p_branch, p_kind, 2)
    returning prefix, padding, 1 into v_prefix, v_padding, v_value;
  end if;

  return v_prefix || lpad(v_value::text, v_padding, '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- Medios de pago
-- -----------------------------------------------------------------------------
create table payment_methods (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  code                  text not null,
  name                  text not null,
  -- Si suma o resta del cajón físico de efectivo.
  affects_cash_drawer   boolean not null default false,
  -- Transferencias y QR pueden quedar «pendiente de confirmación».
  requires_confirmation boolean not null default false,
  commission_rate       app.rate not null default 0,
  commission_fixed      app.money not null default 0,
  settlement_days       int not null default 0,
  -- Descuento (negativo) o recargo (positivo) sugerido para este medio.
  surcharge_rate        app.rate not null default 0,
  allows_change         boolean not null default false,
  is_account_credit     boolean not null default false,  -- cuenta corriente
  sort_order            int not null default 0,
  is_active             boolean not null default true,
  is_demo               boolean not null default false,
  created_at            timestamptz not null default now(),
  unique (organization_id, code)
);

create table sales_channels (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code            text not null,
  name            text not null,
  -- `external` = la venta se cobró afuera; no genera ingreso en caja.
  is_external     boolean not null default false,
  is_active       boolean not null default true,
  is_demo         boolean not null default false,
  unique (organization_id, code)
);

-- -----------------------------------------------------------------------------
-- Auditoría
-- -----------------------------------------------------------------------------
create table audit_logs (
  id              bigserial primary key,
  organization_id uuid references organizations(id) on delete cascade,
  user_id         uuid,
  user_role       app.user_role,
  action          text not null,
  entity          text not null,
  entity_id       text,
  before_data     jsonb,
  after_data      jsonb,
  reason          text,
  ip              inet,
  user_agent      text,
  created_at      timestamptz not null default now()
);
create index on audit_logs (organization_id, created_at desc);
create index on audit_logs (entity, entity_id);

-- Escribe auditoría dentro de la transacción en curso. Nunca se llama desde el
-- navegador: solo desde las funciones transaccionales y triggers.
create or replace function app.audit(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_before jsonb default null,
  p_after jsonb default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into audit_logs (
    organization_id, user_id, user_role, action, entity, entity_id,
    before_data, after_data, reason, ip, user_agent
  )
  values (
    app.current_org_id(), auth.uid(), app.current_role(), p_action, p_entity, p_entity_id,
    p_before, p_after, p_reason,
    nullif(current_setting('app.client_ip', true), '')::inet,
    nullif(current_setting('app.user_agent', true), '')
  );
end;
$$;
