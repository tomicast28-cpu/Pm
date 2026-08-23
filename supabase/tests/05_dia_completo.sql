-- =============================================================================
-- Un día completo de local, de punta a punta.
--
-- Recorre el flujo operativo de la sección 3.1 de la especificación y verifica
-- que cada dato cargado una sola vez alimente stock, caja y resultados.
-- =============================================================================
\set ON_ERROR_STOP on
do $$
declare
  v_salon    uuid := test.location('SALON');
  v_altillo  uuid := test.location('ALTILLO');
  v_canasto  uuid := test.sku('PM-00001');
  v_tabla    uuid := test.sku('PM-00003');
  v_funda    uuid := test.sku('PM-00004');
  v_pinza    uuid := test.sku('PM-00005');
  v_combo_v  uuid := test.sku('PM-00006');
  v_grabado  uuid := test.sku('PM-00008');
  v_register uuid;
  v_session  uuid;
  v_sale     jsonb;
  v_close    jsonb;
  v_declared jsonb;

  v_stock_inicial   app.qty;
  v_caja_esperada   app.money;
  v_ventas_total    app.money;
  v_margen          app.money;
  v_unidades        app.qty;
begin
  raise notice 'Día completo de local';

  -- Este archivo describe un turno completo, así que arranca con la caja
  -- cerrada aunque otro archivo de pruebas haya dejado una sesión abierta.
  perform test.act_as(test.owner_id());
  for v_session in select id from cash_sessions where status = 'open' loop
    select jsonb_object_agg(payment_method_id::text, jsonb_build_object('amount', expected_amount))
      into v_declared from app.cash_session_expected(v_session);
    perform close_cash_session(v_session, coalesce(v_declared, '{}'::jsonb), 'Cierre previo a la prueba');
  end loop;

  -- 1. El empleado abre la caja declarando el efectivo inicial.
  perform test.act_as(test.employee_id());
  select id into v_register from cash_registers limit 1;
  v_session := open_cash_session(v_register, 15000, 'Apertura del turno');
  perform test.assert(v_session is not null, '1 · abre la caja con $15.000');

  v_stock_inicial := app.available_qty(v_tabla, v_salon);

  -- 2. Venta simple en efectivo.
  v_sale := create_instant_sale(
    p_items => jsonb_build_array(
      jsonb_build_object('variant_id', v_tabla, 'quantity', 1, 'location_id', v_salon)),
    p_payments => jsonb_build_array(
      jsonb_build_object('payment_method_id', test.method('efectivo'), 'amount', 32000)),
    p_idempotency_key => 'dia-venta-efectivo');
  perform test.assert_eq((v_sale ->> 'payment_status'), 'paid', '2 · venta en efectivo cobrada');

  -- 3. Venta con pago combinado y descuento del empleado.
  v_sale := create_instant_sale(
    p_items => jsonb_build_array(
      jsonb_build_object('variant_id', v_canasto, 'quantity', 2, 'location_id', v_salon,
                         'discount_amount', 1500, 'discount_reason', 'Se lleva dos')),
    p_payments => jsonb_build_array(
      jsonb_build_object('payment_method_id', test.method('efectivo'), 'amount', 20000),
      jsonb_build_object('payment_method_id', test.method('mercadopago'), 'amount', 14000)),
    p_idempotency_key => 'dia-venta-combinada');
  perform test.assert_eq((v_sale ->> 'total')::numeric, 34000::numeric,
    '3 · total con descuento aplicado (2 × 17.000)');
  perform test.assert_eq((v_sale ->> 'payment_status'), 'paid', '3 · pago combinado saldado');

  -- 4. Venta de combo virtual más un servicio que no descuenta stock.
  v_sale := create_instant_sale(
    p_items => jsonb_build_array(
      jsonb_build_object('variant_id', v_combo_v, 'quantity', 1, 'location_id', v_salon),
      jsonb_build_object('variant_id', v_grabado, 'quantity', 1, 'location_id', v_salon)),
    p_payments => jsonb_build_array(
      jsonb_build_object('payment_method_id', test.method('debito'), 'amount', 40500)),
    p_idempotency_key => 'dia-venta-combo');
  perform test.assert_eq((v_sale ->> 'total')::numeric, 40500::numeric,
    '4 · combo (36.000) + grabado (4.500)');

  -- 5. Llega mercadería del Altillo al Salón por transferencia.
  v_stock_inicial := app.available_qty(v_funda, v_salon);
  perform transfer_stock(v_funda, v_altillo, v_salon, 3, 'Reposición de salón');
  perform test.assert_eq(app.available_qty(v_funda, v_salon) - v_stock_inicial, 3::numeric,
    '5 · la transferencia sumó 3 fundas al salón');

  -- 6. Salida por venta de ecommerce: baja stock, no toca la caja.
  select expected_amount into v_caja_esperada
    from app.cash_session_expected(v_session) where payment_method_id = test.method('efectivo');
  perform online_sale_exit(v_pinza, v_salon, 1, 'ecommerce', 'ML-0099', 'dia-online');
  perform test.assert_eq(
    (select expected_amount from app.cash_session_expected(v_session)
      where payment_method_id = test.method('efectivo')),
    v_caja_esperada, '6 · la venta online no movió el efectivo esperado');

  -- 7. Gasto del día.
  perform record_cash_movement(v_session, 'expense', 3500, 'Bolsas y papel');

  -- 8. El esperado en efectivo refleja apertura + ventas en efectivo − gasto.
  --    15.000 + 32.000 + 20.000 − 3.500 = 63.500
  select expected_amount into v_caja_esperada
    from app.cash_session_expected(v_session) where payment_method_id = test.method('efectivo');
  perform test.assert_eq(v_caja_esperada, 63500::numeric,
    '8 · el efectivo esperado cuadra con las operaciones del día');

  -- 9. Cierre declarando exactamente lo esperado por cada medio.
  select jsonb_object_agg(payment_method_id::text, jsonb_build_object('amount', expected_amount))
    into v_declared from app.cash_session_expected(v_session);

  v_close := close_cash_session(v_session, v_declared, 'Cierre del turno');
  perform test.assert_eq((v_close ->> 'cash_difference')::numeric, 0::numeric,
    '9 · el cierre no arroja diferencias');
  perform test.assert_eq((select status from cash_sessions where id = v_session), 'closed',
    '9 · la caja queda cerrada');

  -- 10. El dueño revisa el resultado del día.
  perform test.act_as(test.owner_id());

  select net_sales, units into v_ventas_total, v_unidades
    from v_sales_daily
   where sale_date = (now() at time zone 'America/Argentina/Buenos_Aires')::date
   limit 1;
  perform test.assert(v_ventas_total >= 106500,
    '10 · las ventas del día suman lo cobrado (' || v_ventas_total || ')');

  select sum(direct_contribution) into v_margen
    from v_sale_margins
   where created_at >= date_trunc('day', now()) and status <> 'cancelled';
  perform test.assert(v_margen is not null, '10 · el dueño ve la contribución directa del día');
  perform test.assert(v_margen > 0, '10 · el día cerró con contribución positiva');

  -- 11. El empleado sigue sin poder ver nada de eso.
  perform test.act_as(test.employee_id());
  perform test.assert_eq(
    (select count(*)::numeric from v_sale_margins where created_at >= date_trunc('day', now())),
    0::numeric, '11 · el empleado no ve el margen del día');

  -- 12. Y no puede reabrir la caja para retocar el turno.
  perform test.assert_raises(
    format('select reopen_cash_session(%L, %L)', v_session, 'quiero corregir'),
    'dueño', '12 · el empleado no puede reabrir el turno cerrado');

  perform test.act_as_admin();
  raise notice 'Día completo OK';
end $$;
