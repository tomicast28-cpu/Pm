-- =============================================================================
-- 0013 — Venta inmediata, pagos y reversión.
--
-- `create_instant_sale` hace TODO en una transacción o no hace nada:
-- crea la venta, valida y descuenta stock (descomponiendo combos virtuales),
-- congela costos, registra pagos y comisiones, mueve la caja, imputa cuenta
-- corriente, numera el comprobante y deja auditoría.
-- =============================================================================

-- Comisión y neto de un cobro según la configuración del medio de pago.
create or replace function app.payment_commission(p_method uuid, p_amount app.money)
returns app.money
language sql
stable
as $$
  select round(coalesce(p_amount * pm.commission_rate + pm.commission_fixed, 0), 2)::app.money
    from payment_methods pm where pm.id = p_method
$$;

-- -----------------------------------------------------------------------------
create or replace function create_instant_sale(
  p_items           jsonb,
  p_payments        jsonb default '[]'::jsonb,
  p_customer_id     uuid default null,
  p_price_list_id   uuid default null,
  p_channel_id      uuid default null,
  p_order_discount  jsonb default null,
  p_shipping_total  app.money default 0,
  p_notes           text default null,
  p_idempotency_key text default null,
  p_allow_oversell  boolean default false,
  p_oversell_reason text default null,
  p_cash_session    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org        uuid := app.current_org_id();
  v_branch     uuid := app.current_branch_id();
  v_order      uuid;
  v_number     text;
  v_customer   uuid := p_customer_id;
  v_price_list uuid := p_price_list_id;
  v_session    uuid := p_cash_session;
  v_movement   uuid;
  v_settings   business_settings;
  v_default_location uuid;

  it            jsonb;
  v_line        int := 0;
  v_variant     product_variants;
  v_product     products;
  v_qty         app.qty;
  v_location    uuid;
  v_list_price  app.money;
  v_unit_price  app.money;
  v_disc_amt    app.money;
  v_disc_rate   app.rate;
  v_line_total  app.money;
  v_tax_rate    app.rate;
  v_item_id     uuid;
  v_available   app.qty;
  v_fifo        app.money;
  v_costs       variant_costs;
  v_bundle_cfg  jsonb;
  comp          record;

  v_subtotal    app.money := 0;
  v_discount    app.money := 0;
  v_tax_total   app.money := 0;
  v_total       app.money := 0;
  v_order_disc  app.money := 0;
  v_order_rate  app.rate := 0;

  pay           jsonb;
  v_method      payment_methods;
  v_pay_amount  app.money;
  v_commission  app.money;
  v_change      app.money := 0;
  v_paid        app.money := 0;
  v_applied     app.money;
  v_payment_id  uuid;
  v_pay_status  text;
  v_credit_total app.money := 0;

  v_payment_state app.payment_status;
  v_existing    uuid;
begin
  perform app.require_permission('sales.create');
  perform app.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0,
                      'La venta no tiene productos');

  -- Idempotencia: el doble clic en «Cobrar» devuelve la misma venta (criterio 5).
  if p_idempotency_key is not null then
    select id into v_existing from orders
     where organization_id = v_org and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('order_id', v_existing, 'duplicate', true,
                                'number', (select number from orders where id = v_existing));
    end if;
  end if;

  select * into v_settings from business_settings where organization_id = v_org;

  if v_price_list is null then
    select id into v_price_list from price_lists
     where organization_id = v_org and is_default and is_active limit 1;
  end if;
  perform app.require(v_price_list is not null, 'No hay lista de precios predeterminada configurada');

  if v_customer is null then
    select id into v_customer from customers where organization_id = v_org and is_walk_in limit 1;
  end if;

  select id into v_default_location from stock_locations
   where branch_id = v_branch and is_default and is_active limit 1;

  -- Vender sin stock es facultad del dueño y exige motivo (8.6).
  if p_allow_oversell then
    perform app.require_owner();
    perform app.require(coalesce(btrim(p_oversell_reason), '') <> '',
                        'Autorizar venta sin stock requiere un motivo');
  end if;

  v_number := app.next_document_number(v_org, 'sale', v_branch);

  insert into orders (
    organization_id, branch_id, number, kind, status, customer_id, price_list_id,
    channel_id, shipping_total, notes, idempotency_key, created_by, confirmed_at,
    fulfillment_status, preparation_status
  )
  values (
    v_org, v_branch, v_number, 'sale', 'completed', v_customer, v_price_list,
    p_channel_id, coalesce(p_shipping_total, 0), p_notes, p_idempotency_key, auth.uid(), now(),
    'fulfilled', 'not_required'
  )
  returning id into v_order;

  v_movement := app.record_movement(v_org, v_branch, 'sale', 'order', v_order,
                                    case when p_allow_oversell then p_oversell_reason else null end);

  -- ---------------------------------------------------------------------------
  -- Líneas
  -- ---------------------------------------------------------------------------
  for it in select * from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;

    select * into v_variant from product_variants
     where id = (it ->> 'variant_id')::uuid and organization_id = v_org;
    perform app.require(found, 'Producto inexistente en la línea ' || v_line);
    select * into v_product from products where id = v_variant.product_id;

    v_qty := coalesce((it ->> 'quantity')::numeric, 1);
    perform app.require(v_qty > 0, 'La cantidad debe ser mayor a cero en la línea ' || v_line);

    v_location := coalesce((it ->> 'location_id')::uuid,
                           v_variant.preferred_location_id, v_default_location);

    v_list_price := coalesce((it ->> 'list_price')::numeric,
                             app.effective_price(v_variant.id, v_price_list));
    perform app.require(v_list_price is not null,
                        'El producto ' || v_variant.sku || ' no tiene precio en la lista elegida');

    select coalesce(tax_rate, coalesce(v_settings.default_tax_rate, 0.21)) into v_tax_rate
      from variant_prices where variant_id = v_variant.id and price_list_id = v_price_list;
    v_tax_rate := coalesce(v_tax_rate, coalesce(v_settings.default_tax_rate, 0.21));

    -- Descuento de línea: importe explícito o porcentaje.
    v_disc_rate := coalesce((it ->> 'discount_rate')::numeric, 0);
    v_disc_amt  := coalesce((it ->> 'discount_amount')::numeric, round(v_list_price * v_disc_rate, 2));
    perform app.require(v_disc_amt >= 0, 'El descuento no puede ser negativo');
    perform app.require(v_disc_amt <= v_list_price, 'El descuento no puede superar el precio');
    if v_list_price > 0 then
      v_disc_rate := round(v_disc_amt / v_list_price, 6);
    end if;

    v_unit_price := coalesce((it ->> 'unit_price')::numeric, v_list_price - v_disc_amt);
    v_line_total := round(v_unit_price * v_qty, 2);

    -- Validación de disponibilidad, incluidas las piezas de un combo (criterio 2).
    if v_product.is_inventoried and v_product.kind <> 'service' then
      v_available := app.available_qty_effective(v_variant.id, v_location);
      if v_qty > v_available and not p_allow_oversell then
        raise exception 'Sin stock suficiente de % (disponible %, pedido %)',
          v_variant.sku, v_available, v_qty
          using errcode = 'check_violation';
      end if;
    end if;

    if v_product.kind in ('bundle_virtual', 'bundle_stocked') then
      select jsonb_agg(jsonb_build_object(
               'component_variant_id', bc.component_variant_id,
               'sku', cv.sku, 'quantity', bc.quantity))
        into v_bundle_cfg
        from bundle_components bc
        join product_variants cv on cv.id = bc.component_variant_id
       where bc.bundle_variant_id = v_variant.id;
    else
      v_bundle_cfg := null;
    end if;

    insert into order_items (
      organization_id, order_id, variant_id, line_number, sku_snapshot, name_snapshot,
      is_service, bundle_mode, bundle_config, quantity, list_price, discount_amount,
      discount_rate, unit_price, tax_rate, line_total, fulfilled_qty, location_id, created_by
    )
    values (
      v_org, v_order, v_variant.id, v_line, v_variant.sku,
      v_product.name || case when v_variant.name <> '' then ' — ' || v_variant.name else '' end,
      not v_product.is_inventoried,
      case v_product.kind when 'bundle_virtual' then 'virtual'
                          when 'bundle_stocked' then 'stocked' else null end,
      v_bundle_cfg, v_qty, v_list_price, v_disc_amt, v_disc_rate, v_unit_price,
      v_tax_rate, v_line_total, v_qty, v_location, auth.uid()
    )
    returning id into v_item_id;

    -- Descuento auditado (5.2): quién, cuánto, por qué, sobre qué precio original.
    if v_disc_amt > 0 then
      insert into order_discounts (
        organization_id, order_id, order_item_id, scope, original_price, final_price,
        discount_amount, discount_rate, reason, created_by
      )
      values (v_org, v_order, v_item_id, 'line', v_list_price, v_unit_price,
              round(v_disc_amt * v_qty, 2), v_disc_rate,
              it ->> 'discount_reason', auth.uid());
    end if;

    -- Descuento de stock. Un combo virtual descuenta sus componentes.
    v_fifo := 0;
    if v_product.is_inventoried and v_product.kind <> 'service' then
      for comp in select * from app.explode_variant(v_variant.id, v_qty) loop
        v_fifo := v_fifo + app.stock_out(
          v_movement, comp.variant_id, v_location, comp.quantity,
          'available', p_allow_oversell
        );
      end loop;
    end if;

    -- Costos congelados al confirmar (9.5). Tabla aparte: el empleado no la lee.
    select * into v_costs from variant_costs where variant_id = v_variant.id;
    insert into order_item_costs (
      order_item_id, organization_id, order_id, variant_id, quantity,
      last_cost, average_cost, fifo_cost, extra_direct_cost
    )
    values (
      v_item_id, v_org, v_order, v_variant.id, v_qty,
      round(coalesce(v_costs.last_cost, 0) * v_qty, 2),
      round(coalesce(v_costs.average_cost, 0) * v_qty, 2),
      round(v_fifo, 2),
      round(coalesce(v_costs.extra_direct_cost, 0) * v_qty, 2)
    );

    v_subtotal  := v_subtotal + round(v_list_price * v_qty, 2);
    v_discount  := v_discount + round(v_disc_amt * v_qty, 2);
    v_total     := v_total + v_line_total;
    v_tax_total := v_tax_total + round(v_line_total * v_tax_rate / (1 + v_tax_rate), 2);
  end loop;

  -- ---------------------------------------------------------------------------
  -- Descuento sobre el total
  -- ---------------------------------------------------------------------------
  if p_order_discount is not null then
    v_order_rate := coalesce((p_order_discount ->> 'rate')::numeric, 0);
    v_order_disc := coalesce((p_order_discount ->> 'amount')::numeric, round(v_total * v_order_rate, 2));
    perform app.require(v_order_disc >= 0, 'El descuento general no puede ser negativo');
    perform app.require(v_order_disc <= v_total, 'El descuento general no puede superar el total');
    if v_total > 0 then v_order_rate := round(v_order_disc / v_total, 6); end if;

    insert into order_discounts (
      organization_id, order_id, scope, original_price, final_price,
      discount_amount, discount_rate, reason, created_by
    )
    values (v_org, v_order, 'order', v_total, v_total - v_order_disc,
            v_order_disc, v_order_rate, p_order_discount ->> 'reason', auth.uid());

    v_discount := v_discount + v_order_disc;
    v_total    := v_total - v_order_disc;
  end if;

  v_total := v_total + coalesce(p_shipping_total, 0);

  -- ---------------------------------------------------------------------------
  -- Cobros
  -- ---------------------------------------------------------------------------
  if jsonb_array_length(coalesce(p_payments, '[]'::jsonb)) > 0 then
    if v_session is null then v_session := app.current_cash_session(v_branch); end if;
    perform app.require(v_session is not null,
                        'No hay una caja abierta. Abrí la caja antes de cobrar.');
    perform app.require(
      (select status from cash_sessions where id = v_session) = 'open',
      'La caja está cerrada: no admite cobros'
    );
    update orders set cash_session_id = v_session where id = v_order;
  end if;

  for pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    select * into v_method from payment_methods
     where id = (pay ->> 'payment_method_id')::uuid and organization_id = v_org and is_active;
    perform app.require(found, 'Medio de pago inexistente o inactivo');

    v_pay_amount := coalesce((pay ->> 'amount')::numeric, 0);
    perform app.require(v_pay_amount > 0, 'El importe del pago debe ser mayor a cero');

    -- Transferencias y QR pueden quedar pendientes de confirmación (10.10).
    v_pay_status := coalesce(pay ->> 'status',
                             case when v_method.requires_confirmation then 'pending' else 'confirmed' end);

    v_commission := app.payment_commission(v_method.id, v_pay_amount);

    insert into payments (
      organization_id, branch_id, payment_method_id, customer_id, order_id, cash_session_id,
      amount, commission_amount, net_amount, installments, status, reference,
      settlement_date, idempotency_key, created_by
    )
    values (
      v_org, v_branch, v_method.id, v_customer, v_order, v_session,
      v_pay_amount, v_commission, v_pay_amount - v_commission,
      coalesce((pay ->> 'installments')::int, 1), v_pay_status, pay ->> 'reference',
      (current_date + coalesce(v_method.settlement_days, 0)),
      nullif(pay ->> 'idempotency_key', ''), auth.uid()
    )
    returning id into v_payment_id;

    if v_pay_status = 'confirmed' then
      if v_method.is_account_credit then
        -- Cuenta corriente: no entra dinero, se registra deuda del cliente.
        v_credit_total := v_credit_total + v_pay_amount;
      else
        v_paid := v_paid + v_pay_amount;
      end if;
    end if;
  end loop;

  -- Vuelto: solo sobre el excedente y solo en un medio que lo admita.
  if v_paid + v_credit_total > v_total then
    v_change := v_paid + v_credit_total - v_total;
    if not exists (
      select 1 from payments p join payment_methods pm on pm.id = p.payment_method_id
       where p.order_id = v_order and pm.allows_change and p.status = 'confirmed'
    ) then
      raise exception 'El cobro supera el total en % y ningún medio admite vuelto',
        to_char(v_change, 'FM999999990.00') using errcode = 'check_violation';
    end if;

    update payments p
       set change_given = v_change
     where p.id = (
       select p2.id from payments p2
         join payment_methods pm on pm.id = p2.payment_method_id
        where p2.order_id = v_order and pm.allows_change and p2.status = 'confirmed'
        order by p2.amount desc limit 1
     );
    v_paid := v_paid - v_change;
  end if;

  -- Imputación y movimientos de caja.
  for v_payment_id in select id from payments where order_id = v_order and status = 'confirmed' loop
    select * into v_method from payment_methods
     where id = (select payment_method_id from payments where id = v_payment_id);
    select amount - change_given into v_applied from payments where id = v_payment_id;

    if v_applied > 0 then
      insert into payment_allocations (organization_id, payment_id, order_id, amount)
      values (v_org, v_payment_id, v_order, v_applied);

      if v_method.is_account_credit then
        insert into customer_account_entries (
          organization_id, customer_id, entry_type, order_id, payment_id,
          amount, due_date, description, created_by
        )
        values (v_org, v_customer, 'sale', v_order, v_payment_id, v_applied,
                current_date + coalesce((select payment_term_days from customers where id = v_customer), 0),
                'Venta ' || v_number, auth.uid());
      else
        insert into cash_movements (
          organization_id, branch_id, session_id, movement_type, payment_method_id,
          payment_id, order_id, amount, affects_drawer, description, created_by
        )
        values (v_org, v_branch, v_session, 'sale', v_method.id, v_payment_id, v_order,
                v_applied, v_method.affects_cash_drawer, 'Venta ' || v_number, auth.uid());
      end if;
    end if;
  end loop;

  -- Un consumidor final no puede quedar debiendo: no hay a quién reclamarle.
  if v_paid + v_credit_total < v_total then
    if (select is_walk_in from customers where id = v_customer) then
      raise exception 'Falta cobrar % y la venta no tiene cliente identificado',
        to_char(v_total - v_paid - v_credit_total, 'FM999999990.00')
        using errcode = 'check_violation';
    end if;
  end if;

  v_payment_state := case
    when v_paid + v_credit_total >= v_total then 'paid'
    when v_paid + v_credit_total > 0 then 'partial'
    else 'unpaid'
  end;

  update orders
     set subtotal = v_subtotal,
         discount_total = v_discount,
         tax_total = v_tax_total,
         total = v_total,
         paid_total = v_paid + v_credit_total,
         payment_status = v_payment_state,
         status = (case when v_payment_state = 'paid' then 'completed' else 'delivered' end)::app.order_status,
         updated_at = now()
   where id = v_order;

  perform app.audit('create_instant_sale', 'order', v_order::text, null,
                    jsonb_build_object('number', v_number, 'total', v_total,
                                       'paid', v_paid, 'account_credit', v_credit_total,
                                       'change', v_change, 'items', jsonb_array_length(p_items)),
                    case when p_allow_oversell then p_oversell_reason else null end);

  return jsonb_build_object(
    'order_id', v_order,
    'number', v_number,
    'subtotal', v_subtotal,
    'discount_total', v_discount,
    'shipping_total', coalesce(p_shipping_total, 0),
    'tax_total', v_tax_total,
    'total', v_total,
    'paid_total', v_paid + v_credit_total,
    'change', v_change,
    'payment_status', v_payment_state,
    'duplicate', false
  );
end;
$$;
