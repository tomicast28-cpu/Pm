-- =============================================================================
-- 0011 — Primitivas de stock.
--
-- Nadie escribe `inventory_balances` ni `inventory_lots` fuera de acá.
-- Toda salida consume lotes por FIFO, para conocer antigüedad y costo histórico.
-- =============================================================================

-- Abre (o encuentra) la fila de saldo y la BLOQUEA. El bloqueo es lo que impide
-- que dos ventas concurrentes consuman la misma última unidad.
create or replace function app.lock_balance(
  p_org uuid, p_branch uuid, p_variant uuid, p_location uuid, p_state app.stock_state
)
returns inventory_balances
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row inventory_balances;
begin
  insert into inventory_balances (organization_id, branch_id, variant_id, location_id, state)
  values (p_org, p_branch, p_variant, p_location, p_state)
  on conflict (variant_id, location_id, state) do nothing;

  select * into v_row
    from inventory_balances
   where variant_id = p_variant and location_id = p_location and state = p_state
   for update;

  return v_row;
end;
$$;

create or replace function app.record_movement(
  p_org uuid,
  p_branch uuid,
  p_type app.movement_type,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_reason text default null,
  p_notes text default null,
  p_reversal_of uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  insert into inventory_movements (
    organization_id, branch_id, movement_type, reference_type, reference_id,
    reason, notes, reversal_of_id, created_by
  )
  values (p_org, p_branch, p_type, p_reference_type, p_reference_id,
          p_reason, p_notes, p_reversal_of, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Ingreso: crea lote y sube saldo.
-- -----------------------------------------------------------------------------
create or replace function app.stock_in(
  p_movement uuid,
  p_variant uuid,
  p_location uuid,
  p_qty app.qty,
  p_unit_cost app.money default 0,
  p_state app.stock_state default 'available',
  p_supplier uuid default null,
  p_purchase uuid default null,
  p_received_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mov inventory_movements;
  v_lot uuid;
begin
  perform app.require(p_qty > 0, 'La cantidad a ingresar debe ser mayor a cero');
  select * into v_mov from inventory_movements where id = p_movement;
  perform app.require(found, 'Movimiento de stock inexistente');

  insert into inventory_lots (
    organization_id, branch_id, variant_id, location_id, received_at,
    original_quantity, remaining_quantity, unit_cost, supplier_id, purchase_id
  )
  values (
    v_mov.organization_id, v_mov.branch_id, p_variant, p_location,
    coalesce(p_received_at, now()), p_qty, p_qty, coalesce(p_unit_cost, 0),
    p_supplier, p_purchase
  )
  returning id into v_lot;

  perform app.lock_balance(v_mov.organization_id, v_mov.branch_id, p_variant, p_location, p_state);

  update inventory_balances
     set on_hand = on_hand + p_qty, updated_at = now()
   where variant_id = p_variant and location_id = p_location and state = p_state;

  insert into inventory_movement_items (
    organization_id, movement_id, variant_id, to_location_id, to_state,
    quantity, unit_cost, lot_id
  )
  values (v_mov.organization_id, p_movement, p_variant, p_location, p_state,
          p_qty, coalesce(p_unit_cost, 0), v_lot);

  return v_lot;
end;
$$;

-- -----------------------------------------------------------------------------
-- Salida: consume lotes por FIFO y baja saldo. Devuelve el costo FIFO total.
-- -----------------------------------------------------------------------------
create or replace function app.stock_out(
  p_movement uuid,
  p_variant uuid,
  p_location uuid,
  p_qty app.qty,
  p_state app.stock_state default 'available',
  p_allow_negative boolean default false,
  p_consume_reservation boolean default false
)
returns app.money
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mov       inventory_movements;
  v_balance   inventory_balances;
  v_available app.qty;
  v_remaining app.qty := p_qty;
  v_fifo_cost app.money := 0;
  v_sku       text;
  lot         record;
  v_take      app.qty;
begin
  perform app.require(p_qty > 0, 'La cantidad a descontar debe ser mayor a cero');
  select * into v_mov from inventory_movements where id = p_movement;
  perform app.require(found, 'Movimiento de stock inexistente');

  v_balance := app.lock_balance(v_mov.organization_id, v_mov.branch_id, p_variant, p_location, p_state);

  -- Al entregar una reserva el físico ya estaba comprometido: se mide contra
  -- `on_hand`. En una venta directa se mide contra el disponible real.
  v_available := case
    when p_consume_reservation then v_balance.on_hand
    else v_balance.on_hand - v_balance.reserved
  end;

  if v_remaining > v_available and not p_allow_negative then
    select sku into v_sku from product_variants where id = p_variant;
    raise exception 'Stock insuficiente para % (disponible %, solicitado %)',
      coalesce(v_sku, p_variant::text), v_available, p_qty
      using errcode = 'check_violation';
  end if;

  -- FIFO: se consumen primero los lotes más antiguos.
  for lot in
    select id, remaining_quantity, unit_cost
      from inventory_lots
     where variant_id = p_variant
       and location_id = p_location
       and remaining_quantity > 0
     order by received_at, id
     for update
  loop
    exit when v_remaining <= 0;
    v_take := least(lot.remaining_quantity, v_remaining);

    update inventory_lots
       set remaining_quantity = remaining_quantity - v_take
     where id = lot.id;

    insert into inventory_movement_items (
      organization_id, movement_id, variant_id, from_location_id, from_state,
      quantity, unit_cost, lot_id
    )
    values (v_mov.organization_id, p_movement, p_variant, p_location, p_state,
            v_take, lot.unit_cost, lot.id);

    v_fifo_cost := v_fifo_cost + (v_take * lot.unit_cost);
    v_remaining := v_remaining - v_take;
  end loop;

  -- Sin lotes suficientes (stock inicial sin costo o venta autorizada sin stock):
  -- se registra igual el movimiento, con costo cero, para no perder la trazabilidad.
  if v_remaining > 0 then
    insert into inventory_movement_items (
      organization_id, movement_id, variant_id, from_location_id, from_state,
      quantity, unit_cost, lot_id
    )
    values (v_mov.organization_id, p_movement, p_variant, p_location, p_state,
            v_remaining, 0, null);
  end if;

  update inventory_balances
     set on_hand = on_hand - p_qty, updated_at = now()
   where variant_id = p_variant and location_id = p_location and state = p_state;

  return v_fifo_cost;
end;
$$;

-- -----------------------------------------------------------------------------
-- Composición de combos.
-- Un combo virtual no tiene stock propio: se resuelve en sus componentes.
-- Un combo prearmado sí lo tiene y se trata como cualquier variante.
-- -----------------------------------------------------------------------------
create or replace function app.explode_variant(p_variant uuid, p_qty app.qty)
returns table (variant_id uuid, quantity app.qty)
language plpgsql
stable
as $$
declare v_kind app.product_kind;
begin
  select p.kind into v_kind
    from product_variants v join products p on p.id = v.product_id
   where v.id = p_variant;

  if v_kind = 'bundle_virtual' then
    return query
      select bc.component_variant_id, (bc.quantity * p_qty)::app.qty
        from bundle_components bc
       where bc.bundle_variant_id = p_variant;
  else
    return query select p_variant, p_qty;
  end if;
end;
$$;

-- Disponibilidad real: para un combo virtual es el mínimo que permiten sus piezas.
create or replace function app.available_qty_effective(p_variant uuid, p_location uuid default null)
returns app.qty
language plpgsql
stable
as $$
declare
  v_kind app.product_kind;
  v_min  app.qty;
begin
  select p.kind into v_kind
    from product_variants v join products p on p.id = v.product_id
   where v.id = p_variant;

  if v_kind = 'service' then
    return 999999;      -- los servicios no tienen stock
  end if;

  if v_kind = 'bundle_virtual' then
    select min(floor(app.available_qty(bc.component_variant_id, p_location) / bc.quantity))
      into v_min
      from bundle_components bc
     where bc.bundle_variant_id = p_variant;
    return coalesce(v_min, 0);
  end if;

  return app.available_qty(p_variant, p_location);
end;
$$;

-- -----------------------------------------------------------------------------
-- Transferencia interna Salón <-> Altillo (nunca se editan cantidades a mano).
-- -----------------------------------------------------------------------------
create or replace function transfer_stock(
  p_variant uuid,
  p_from_location uuid,
  p_to_location uuid,
  p_quantity app.qty,
  p_reason text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid := app.current_org_id();
  v_branch uuid;
  v_mov    uuid;
  v_cost   app.money;
  v_existing uuid;
begin
  perform app.require_permission('stock.transfer');
  perform app.require(p_from_location <> p_to_location, 'El origen y el destino deben ser distintos');
  perform app.require(p_quantity > 0, 'La cantidad debe ser mayor a cero');

  if p_idempotency_key is not null then
    select id into v_existing from inventory_movements
     where organization_id = v_org and movement_type = 'transfer' and notes = p_idempotency_key;
    if found then return v_existing; end if;
  end if;

  select branch_id into v_branch from stock_locations where id = p_from_location;
  perform app.require(v_branch is not null, 'Ubicación de origen inexistente');

  v_mov := app.record_movement(v_org, v_branch, 'transfer', 'transfer', null, p_reason, p_idempotency_key);
  v_cost := app.stock_out(v_mov, p_variant, p_from_location, p_quantity);
  perform app.stock_in(v_mov, p_variant, p_to_location, p_quantity,
                       case when p_quantity > 0 then round(v_cost / p_quantity, 2) else 0 end);

  perform app.audit('transfer_stock', 'inventory_movement', v_mov::text, null,
                    jsonb_build_object('variant_id', p_variant, 'quantity', p_quantity,
                                       'from', p_from_location, 'to', p_to_location),
                    p_reason);
  return v_mov;
end;
$$;

-- -----------------------------------------------------------------------------
-- Ajuste manual de stock. Exige motivo y es facultad del dueño.
-- -----------------------------------------------------------------------------
create or replace function adjust_stock(
  p_variant uuid,
  p_location uuid,
  p_quantity app.qty,          -- positivo suma, negativo resta
  p_reason text,
  p_unit_cost app.money default 0,
  p_state app.stock_state default 'available'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid := app.current_org_id();
  v_branch uuid;
  v_mov    uuid;
begin
  perform app.require_permission('stock.adjust');
  perform app.require(p_quantity <> 0, 'El ajuste no puede ser cero');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'El ajuste de stock requiere un motivo');

  select branch_id into v_branch from stock_locations where id = p_location;
  perform app.require(v_branch is not null, 'Ubicación inexistente');

  v_mov := app.record_movement(
    v_org, v_branch,
    case when p_quantity > 0 then 'adjustment_in' else 'adjustment_out' end,
    'adjustment', null, p_reason
  );

  if p_quantity > 0 then
    perform app.stock_in(v_mov, p_variant, p_location, p_quantity, p_unit_cost, p_state);
  else
    perform app.stock_out(v_mov, p_variant, p_location, -p_quantity, p_state);
  end if;

  perform app.audit('adjust_stock', 'inventory_movement', v_mov::text, null,
                    jsonb_build_object('variant_id', p_variant, 'quantity', p_quantity,
                                       'location', p_location, 'state', p_state),
                    p_reason);
  return v_mov;
end;
$$;

-- -----------------------------------------------------------------------------
-- Armado y desarmado de combos prearmados.
-- -----------------------------------------------------------------------------
create or replace function assemble_bundle(
  p_bundle_variant uuid,
  p_location uuid,
  p_quantity app.qty,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid := app.current_org_id();
  v_branch uuid;
  v_mov    uuid;
  v_kind   app.product_kind;
  v_cost   app.money := 0;
  comp     record;
begin
  perform app.require_permission('stock.assemble');
  perform app.require(p_quantity > 0, 'La cantidad debe ser mayor a cero');

  select p.kind into v_kind
    from product_variants v join products p on p.id = v.product_id
   where v.id = p_bundle_variant;
  perform app.require(v_kind = 'bundle_stocked',
                      'Solo se arman combos prearmados; los virtuales se descuentan al vender');

  select branch_id into v_branch from stock_locations where id = p_location;
  perform app.require(v_branch is not null, 'Ubicación inexistente');

  v_mov := app.record_movement(v_org, v_branch, 'bundle_assemble', 'bundle', p_bundle_variant, p_reason);

  for comp in
    select component_variant_id, quantity from bundle_components
     where bundle_variant_id = p_bundle_variant
  loop
    v_cost := v_cost + app.stock_out(v_mov, comp.component_variant_id, p_location,
                                     comp.quantity * p_quantity);
  end loop;

  perform app.stock_in(v_mov, p_bundle_variant, p_location, p_quantity,
                       round(v_cost / p_quantity, 2));

  perform app.audit('assemble_bundle', 'inventory_movement', v_mov::text, null,
                    jsonb_build_object('bundle_variant_id', p_bundle_variant,
                                       'quantity', p_quantity, 'location', p_location),
                    p_reason);
  return v_mov;
end;
$$;

create or replace function disassemble_bundle(
  p_bundle_variant uuid,
  p_location uuid,
  p_quantity app.qty,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid := app.current_org_id();
  v_branch uuid;
  v_mov    uuid;
  v_cost   app.money;
  v_unit   app.money;
  v_total_units app.qty := 0;
  comp     record;
begin
  perform app.require_permission('stock.assemble');
  perform app.require(p_quantity > 0, 'La cantidad debe ser mayor a cero');

  select branch_id into v_branch from stock_locations where id = p_location;
  perform app.require(v_branch is not null, 'Ubicación inexistente');

  v_mov := app.record_movement(v_org, v_branch, 'bundle_disassemble', 'bundle', p_bundle_variant, p_reason);
  v_cost := app.stock_out(v_mov, p_bundle_variant, p_location, p_quantity);

  select coalesce(sum(quantity), 0) into v_total_units
    from bundle_components where bundle_variant_id = p_bundle_variant;
  perform app.require(v_total_units > 0, 'El combo no tiene componentes definidos');

  -- El costo del combo se reparte entre las piezas según su participación.
  v_unit := round(v_cost / (v_total_units * p_quantity), 2);

  for comp in
    select component_variant_id, quantity from bundle_components
     where bundle_variant_id = p_bundle_variant
  loop
    perform app.stock_in(v_mov, comp.component_variant_id, p_location,
                         comp.quantity * p_quantity, v_unit);
  end loop;

  perform app.audit('disassemble_bundle', 'inventory_movement', v_mov::text, null,
                    jsonb_build_object('bundle_variant_id', p_bundle_variant,
                                       'quantity', p_quantity, 'location', p_location),
                    p_reason);
  return v_mov;
end;
$$;

-- -----------------------------------------------------------------------------
-- Salida por venta online (8.8): baja stock, sin ingreso en caja.
-- -----------------------------------------------------------------------------
create or replace function online_sale_exit(
  p_variant uuid,
  p_location uuid,
  p_quantity app.qty,
  p_channel_code text default 'ecommerce',
  p_reference text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid := app.current_org_id();
  v_branch uuid;
  v_mov    uuid;
  v_existing uuid;
begin
  perform app.require_permission('stock.online_exit');
  perform app.require(p_quantity > 0, 'La cantidad debe ser mayor a cero');

  if p_idempotency_key is not null then
    select id into v_existing from inventory_movements
     where organization_id = v_org
       and movement_type = 'online_sale_exit'
       and notes = p_idempotency_key;
    if found then return v_existing; end if;
  end if;

  select branch_id into v_branch from stock_locations where id = p_location;
  perform app.require(v_branch is not null, 'Ubicación inexistente');

  v_mov := app.record_movement(
    v_org, v_branch, 'online_sale_exit', 'online_sale', null,
    coalesce(p_channel_code, 'ecommerce') || coalesce(' · ' || p_reference, ''),
    p_idempotency_key
  );

  -- Un combo virtual vendido online descuenta sus componentes.
  declare comp record;
  begin
    for comp in select * from app.explode_variant(p_variant, p_quantity) loop
      perform app.stock_out(v_mov, comp.variant_id, p_location, comp.quantity);
    end loop;
  end;

  perform app.audit('online_sale_exit', 'inventory_movement', v_mov::text, null,
                    jsonb_build_object('variant_id', p_variant, 'quantity', p_quantity,
                                       'channel', p_channel_code, 'reference', p_reference),
                    null);
  return v_mov;
end;
$$;
