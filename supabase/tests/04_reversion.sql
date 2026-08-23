-- =============================================================================
-- Criterios 25, 26: revertir no borra la venta y genera contramovimientos.
-- =============================================================================
\set ON_ERROR_STOP on
do $$
declare
  v_salon   uuid := test.location('SALON');
  v_canasto uuid := test.sku('PM-00001');
  v_result  jsonb;
  v_order   uuid;
  v_before  app.qty;
  v_session uuid;
  v_drawer_before app.money;
  v_drawer_after  app.money;
begin
  raise notice 'Reversión de ventas';
  perform test.act_as(test.employee_id());

  select app.current_cash_session() into v_session;
  if v_session is null then
    v_session := open_cash_session((select id from cash_registers limit 1), 0);
  end if;

  v_before := app.available_qty(v_canasto, v_salon);
  select coalesce(sum(amount), 0) into v_drawer_before
    from cash_movements where session_id = v_session and affects_drawer;

  v_result := create_instant_sale(
    p_items => jsonb_build_array(
      jsonb_build_object('variant_id', v_canasto, 'quantity', 1, 'location_id', v_salon)
    ),
    p_payments => jsonb_build_array(
      jsonb_build_object('payment_method_id', test.method('efectivo'), 'amount', 18500)
    ),
    p_idempotency_key => 'test-reversion-1'
  );
  v_order := (v_result ->> 'order_id')::uuid;

  -- El empleado no puede revertir.
  perform test.assert_raises(
    format('select reverse_sale(%L, %L)', v_order, 'me equivoqué'),
    'dueño', 'el empleado no puede revertir una venta');

  perform test.act_as(test.owner_id());
  perform test.assert_raises(
    format('select reverse_sale(%L, %L)', v_order, ''),
    'motivo', 'revertir exige un motivo');

  perform reverse_sale(v_order, 'El cliente se arrepintió');

  -- Criterio 25: la venta sigue existiendo.
  perform test.assert(
    exists (select 1 from orders where id = v_order),
    'criterio 25 · la venta no se borra');
  perform test.assert_eq(
    (select status::text from orders where id = v_order), 'cancelled',
    'criterio 25 · la venta queda marcada como anulada');
  perform test.assert(
    exists (select 1 from order_items where order_id = v_order),
    'criterio 25 · las líneas de la venta se conservan');

  -- Criterio 26: contramovimientos de stock y dinero.
  perform test.assert_eq(app.available_qty(v_canasto, v_salon), v_before,
    'criterio 26 · el stock vuelve a su cantidad original');

  perform test.assert(
    exists (select 1 from inventory_movements
             where reference_id = v_order and movement_type = 'reversal'),
    'criterio 26 · se registra un movimiento de reversión');

  perform test.assert(
    exists (select 1 from payments where order_id = v_order and direction = 'out'),
    'criterio 26 · se genera el contramovimiento de dinero');

  perform test.assert_eq(
    (select status from payments where order_id = v_order and direction = 'in'), 'reversed',
    'criterio 26 · el pago original queda marcado como revertido');

  select coalesce(sum(amount), 0) into v_drawer_after
    from cash_movements where session_id = v_session and affects_drawer;
  perform test.assert_eq(v_drawer_after, v_drawer_before,
    'criterio 26 · el cajón vuelve a su saldo previo');

  perform test.assert(
    exists (select 1 from audit_logs where entity = 'order' and entity_id = v_order::text
              and action = 'reverse_sale' and reason = 'El cliente se arrepintió'),
    'la reversión queda auditada con su motivo');

  perform test.act_as_admin();
  raise notice 'Reversión OK';
end $$;
