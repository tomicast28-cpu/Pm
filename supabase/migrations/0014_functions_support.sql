-- =============================================================================
-- 0014 — Reversión de ventas, cobros posteriores, precios, costos y datos demo.
-- =============================================================================

-- Reversión: NUNCA se borra una venta. Se generan contramovimientos (4.2).
create or replace function reverse_sale(p_order uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org      uuid := app.current_org_id();
  v_order    orders;
  v_movement uuid;
  v_session  uuid;
  it         record;
  pay        record;
  comp       record;
  v_new_pay  uuid;
begin
  perform app.require_owner();
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Revertir una venta requiere un motivo');

  select * into v_order from orders where id = p_order and organization_id = v_org for update;
  perform app.require(found, 'Venta inexistente');
  perform app.require(v_order.status <> 'cancelled', 'La venta ya fue revertida');

  -- Un período cerrado no se toca: primero hay que reabrir la caja.
  if v_order.cash_session_id is not null then
    perform app.require(
      (select status from cash_sessions where id = v_order.cash_session_id) = 'open',
      'La caja de esa venta está cerrada. Reabrila para poder revertir.'
    );
  end if;

  v_movement := app.record_movement(v_org, v_order.branch_id, 'reversal', 'order', p_order, p_reason);

  -- Devolver el stock a su ubicación de origen.
  for it in
    select oi.*, p.kind, p.is_inventoried
      from order_items oi
      join product_variants pv on pv.id = oi.variant_id
      join products p on p.id = pv.product_id
     where oi.order_id = p_order
  loop
    if it.is_inventoried and it.kind <> 'service' then
      for comp in select * from app.explode_variant(it.variant_id, it.quantity) loop
        perform app.stock_in(v_movement, comp.variant_id, it.location_id, comp.quantity, 0);
      end loop;
    end if;
  end loop;

  -- Contramovimientos de dinero.
  for pay in select * from payments where order_id = p_order and status = 'confirmed' loop
    insert into payments (
      organization_id, branch_id, direction, payment_method_id, customer_id, order_id,
      cash_session_id, amount, commission_amount, net_amount, status, reversal_of_id,
      notes, created_by
    )
    values (
      v_org, pay.branch_id, 'out', pay.payment_method_id, pay.customer_id, p_order,
      pay.cash_session_id, pay.amount - pay.change_given, -pay.commission_amount,
      -(pay.amount - pay.change_given - pay.commission_amount), 'confirmed', pay.id,
      'Reversión de ' || v_order.number, auth.uid()
    )
    returning id into v_new_pay;

    update payments set status = 'reversed' where id = pay.id;

    if pay.cash_session_id is not null then
      insert into cash_movements (
        organization_id, branch_id, session_id, movement_type, payment_method_id,
        payment_id, order_id, amount, affects_drawer, description, reason, created_by
      )
      select v_org, pay.branch_id, pay.cash_session_id, 'refund', pay.payment_method_id,
             v_new_pay, p_order, -(pay.amount - pay.change_given), pm.affects_cash_drawer,
             'Reversión de ' || v_order.number, p_reason, auth.uid()
        from payment_methods pm where pm.id = pay.payment_method_id;
    end if;
  end loop;

  -- Revertir la imputación en cuenta corriente.
  insert into customer_account_entries (
    organization_id, customer_id, entry_type, order_id, amount, description, created_by
  )
  select v_org, cae.customer_id, 'credit_note', p_order, -cae.amount,
         'Reversión de ' || v_order.number, auth.uid()
    from customer_account_entries cae
   where cae.order_id = p_order and cae.entry_type = 'sale';

  update orders
     set status = 'cancelled',
         payment_status = 'refunded',
         cancelled_at = now(),
         cancel_reason = p_reason,
         refunded_total = paid_total,
         updated_at = now()
   where id = p_order;

  perform app.audit('reverse_sale', 'order', p_order::text, to_jsonb(v_order),
                    jsonb_build_object('status', 'cancelled', 'movement_id', v_movement), p_reason);
  return v_movement;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cobro posterior sobre un pedido existente (seña, saldo, cuenta corriente).
-- -----------------------------------------------------------------------------
create or replace function add_order_payment(
  p_order uuid,
  p_payment_method uuid,
  p_amount app.money,
  p_reference text default null,
  p_status text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org      uuid := app.current_org_id();
  v_order    orders;
  v_method   payment_methods;
  v_session  uuid;
  v_payment  uuid;
  v_status   text;
  v_commission app.money;
  v_paid     app.money;
  v_existing uuid;
begin
  perform app.require_permission('payments.create');
  perform app.require(p_amount > 0, 'El importe debe ser mayor a cero');

  if p_idempotency_key is not null then
    select id into v_existing from payments
     where organization_id = v_org and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('payment_id', v_existing, 'duplicate', true);
    end if;
  end if;

  select * into v_order from orders where id = p_order and organization_id = v_org for update;
  perform app.require(found, 'Pedido inexistente');
  perform app.require(v_order.status <> 'cancelled', 'El pedido está cancelado');

  select * into v_method from payment_methods
   where id = p_payment_method and organization_id = v_org and is_active;
  perform app.require(found, 'Medio de pago inexistente o inactivo');

  perform app.require(p_amount <= v_order.balance_due + 0.001,
                      'El cobro supera el saldo pendiente del pedido');

  v_status := coalesce(p_status,
                       case when v_method.requires_confirmation then 'pending' else 'confirmed' end);
  v_commission := app.payment_commission(v_method.id, p_amount);

  if not v_method.is_account_credit and v_status = 'confirmed' then
    v_session := app.current_cash_session(v_order.branch_id);
    perform app.require(v_session is not null, 'No hay una caja abierta para registrar el cobro');
  end if;

  insert into payments (
    organization_id, branch_id, payment_method_id, customer_id, order_id, cash_session_id,
    amount, commission_amount, net_amount, status, reference, settlement_date,
    idempotency_key, created_by
  )
  values (
    v_org, v_order.branch_id, v_method.id, v_order.customer_id, p_order, v_session,
    p_amount, v_commission, p_amount - v_commission, v_status, p_reference,
    current_date + coalesce(v_method.settlement_days, 0), p_idempotency_key, auth.uid()
  )
  returning id into v_payment;

  if v_status = 'confirmed' then
    insert into payment_allocations (organization_id, payment_id, order_id, amount)
    values (v_org, v_payment, p_order, p_amount);

    if v_method.is_account_credit then
      insert into customer_account_entries (
        organization_id, customer_id, entry_type, order_id, payment_id, amount, description, created_by
      )
      values (v_org, v_order.customer_id, 'sale', p_order, v_payment, p_amount,
              'Pedido ' || v_order.number, auth.uid());
    else
      insert into cash_movements (
        organization_id, branch_id, session_id, movement_type, payment_method_id,
        payment_id, order_id, amount, affects_drawer, description, created_by
      )
      values (v_org, v_order.branch_id, v_session, 'sale', v_method.id, v_payment, p_order,
              p_amount, v_method.affects_cash_drawer, 'Cobro ' || v_order.number, auth.uid());
    end if;

    select coalesce(sum(amount), 0) into v_paid
      from payment_allocations where order_id = p_order;

    update orders
       set paid_total = v_paid,
           payment_status = case
             when v_paid >= total then 'paid'
             when v_paid > 0 then 'partial'
             else 'unpaid' end,
           updated_at = now()
     where id = p_order;
  end if;

  perform app.audit('add_order_payment', 'payment', v_payment::text, null,
                    jsonb_build_object('order_id', p_order, 'amount', p_amount,
                                       'method', v_method.code, 'status', v_status), null);

  return jsonb_build_object('payment_id', v_payment, 'status', v_status, 'duplicate', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Precios y costos: siempre con historial (criterio de aceptación 30).
-- -----------------------------------------------------------------------------
create or replace function set_variant_price(
  p_variant uuid,
  p_price_list uuid,
  p_price app.money,
  p_reason text default null,
  p_tax_rate app.rate default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := app.current_org_id();
  v_old app.money;
  v_tax app.rate;
begin
  perform app.require_permission('prices.manage');
  perform app.require(p_price >= 0, 'El precio no puede ser negativo');

  select price into v_old from variant_prices
   where variant_id = p_variant and price_list_id = p_price_list;

  v_tax := coalesce(p_tax_rate,
                    (select default_tax_rate from business_settings where organization_id = v_org),
                    0.21);

  insert into variant_prices (organization_id, variant_id, price_list_id, price, tax_rate)
  values (v_org, p_variant, p_price_list, p_price, v_tax)
  on conflict (variant_id, price_list_id)
  do update set price = excluded.price, tax_rate = excluded.tax_rate, updated_at = now();

  insert into price_history (organization_id, variant_id, price_list_id, old_price, new_price, reason, changed_by)
  values (v_org, p_variant, p_price_list, v_old, p_price, p_reason, auth.uid());

  perform app.audit('set_variant_price', 'variant_price', p_variant::text,
                    jsonb_build_object('price', v_old),
                    jsonb_build_object('price', p_price, 'price_list_id', p_price_list), p_reason);
end;
$$;

create or replace function set_variant_cost(
  p_variant uuid,
  p_last_cost app.money,
  p_reason text default null,
  p_source text default 'manual',
  p_supplier uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := app.current_org_id();
  v_old variant_costs;
begin
  perform app.require_owner();
  perform app.require(p_last_cost >= 0, 'El costo no puede ser negativo');

  select * into v_old from variant_costs where variant_id = p_variant;

  insert into variant_costs (variant_id, organization_id, last_cost, average_cost, last_cost_at, last_supplier_id)
  values (p_variant, v_org, p_last_cost, p_last_cost, now(), p_supplier)
  on conflict (variant_id) do update
    set last_cost = excluded.last_cost,
        last_cost_at = now(),
        last_supplier_id = coalesce(excluded.last_supplier_id, variant_costs.last_supplier_id),
        updated_at = now();

  insert into cost_history (
    organization_id, variant_id, old_cost, new_cost, old_average_cost, new_average_cost,
    source, supplier_id, reason, changed_by
  )
  values (v_org, p_variant, v_old.last_cost, p_last_cost, v_old.average_cost,
          coalesce(v_old.average_cost, p_last_cost), p_source, p_supplier, p_reason, auth.uid());

  perform app.audit('set_variant_cost', 'variant_cost', p_variant::text,
                    to_jsonb(v_old), jsonb_build_object('last_cost', p_last_cost), p_reason);
end;
$$;

-- Recalcula el costo promedio ponderado a partir de los lotes vivos.
create or replace function app.recalc_average_cost(p_variant uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_avg app.money;
begin
  select case when sum(remaining_quantity) > 0
              then round(sum(remaining_quantity * unit_cost) / sum(remaining_quantity), 2)
              else null end
    into v_avg
    from inventory_lots
   where variant_id = p_variant and remaining_quantity > 0;

  if v_avg is not null then
    update variant_costs set average_cost = v_avg, updated_at = now() where variant_id = p_variant;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Datos demo: identificados y borrables antes de producción (33).
-- -----------------------------------------------------------------------------
create or replace function app.purge_demo_data()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_count int;
begin
  perform app.require_owner();
  select id into v_org from organizations where is_demo;
  if v_org is null then
    return 'No hay datos demo para borrar.';
  end if;

  -- Todo cuelga de la organización por FK en cascada.
  delete from organizations where id = v_org;
  get diagnostics v_count = row_count;
  return format('Se eliminaron los datos demo (%s organización).', v_count);
end;
$$;

-- Próximo SKU interno automático (decisión 3: SKU automático editable).
create or replace function next_sku()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.require_permission('catalog.manage');
  return app.next_document_number(app.current_org_id(), 'sku', null);
end;
$$;

-- Envoltorio público de `app.cash_session_expected`: PostgREST solo expone
-- funciones del esquema `public`. Valida que la sesión sea de la organización
-- de quien pregunta antes de devolver nada.
create or replace function cash_session_expected_public(p_session uuid)
returns table (
  payment_method_id uuid,
  label text,
  affects_drawer boolean,
  expected_amount app.money
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from cash_sessions
     where id = p_session and organization_id = app.current_org_id()
  ) then
    raise exception 'Sesión de caja inexistente' using errcode = 'no_data_found';
  end if;

  return query select * from app.cash_session_expected(p_session);
end;
$$;
