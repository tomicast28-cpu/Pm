-- =============================================================================
-- Criterios 1, 2, 3, 5, 6, 7, 12, 13, 14: venta, stock, combos, pagos.
-- =============================================================================
\set ON_ERROR_STOP on
do $$
declare
  v_salon    uuid := test.location('SALON');
  v_altillo  uuid := test.location('ALTILLO');
  v_tabla    uuid := test.sku('PM-00003');
  v_pinza    uuid := test.sku('PM-00005');
  v_funda    uuid := test.sku('PM-00004');
  v_canasto  uuid := test.sku('PM-00001');
  v_combo_v  uuid := test.sku('PM-00006');
  v_combo_p  uuid := test.sku('PM-00007');
  v_grabado  uuid := test.sku('PM-00008');
  v_register uuid;
  v_session  uuid;
  v_result   jsonb;
  v_result2  jsonb;
  v_before   app.qty;
  v_after    app.qty;
  v_before_p app.qty;
  v_drawer   app.money;
  v_drawer2  app.money;
  v_commission app.money;
  v_order    uuid;
begin
  raise notice 'Ventas y stock';
  perform test.act_as(test.employee_id());

  -- ---------------------------------------------------------------------------
  -- Criterio 16: no se puede abrir una segunda sesión sobre la misma caja
  -- ---------------------------------------------------------------------------
  select id into v_register from cash_registers limit 1;
  v_session := open_cash_session(v_register, 20000);
  perform test.assert(v_session is not null, 'la caja abre con efectivo inicial');

  perform test.assert_raises(
    format('select open_cash_session(%L, 0)', v_register),
    'ya hay una sesión', 'criterio 16 · no se abre una segunda sesión sobre la misma caja');

  -- ---------------------------------------------------------------------------
  -- Criterio 1: vender dos unidades simples reduce exactamente el stock
  -- ---------------------------------------------------------------------------
  v_before := app.available_qty(v_tabla, v_salon);

  v_result := create_instant_sale(
    p_items => jsonb_build_array(
      jsonb_build_object('variant_id', v_tabla, 'quantity', 2, 'location_id', v_salon)
    ),
    p_payments => jsonb_build_array(
      jsonb_build_object('payment_method_id', test.method('efectivo'), 'amount', 64000)
    ),
    p_idempotency_key => 'test-venta-1'
  );

  v_after := app.available_qty(v_tabla, v_salon);
  perform test.assert_eq(v_before - v_after, 2::numeric,
    'criterio 1 · vender 2 unidades descuenta exactamente 2');
  perform test.assert_eq((v_result ->> 'total')::numeric, 64000::numeric,
    'el total de la venta es correcto');
  perform test.assert_eq(v_result ->> 'payment_status', 'paid', 'la venta queda pagada');

  -- ---------------------------------------------------------------------------
  -- Criterio 5: doble clic en Cobrar no duplica venta ni pago
  -- ---------------------------------------------------------------------------
  v_result2 := create_instant_sale(
    p_items => jsonb_build_array(
      jsonb_build_object('variant_id', v_tabla, 'quantity', 2, 'location_id', v_salon)
    ),
    p_payments => jsonb_build_array(
      jsonb_build_object('payment_method_id', test.method('efectivo'), 'amount', 64000)
    ),
    p_idempotency_key => 'test-venta-1'
  );
  perform test.assert_eq((v_result2 ->> 'duplicate')::boolean, true,
    'criterio 5 · el segundo clic devuelve la misma venta');
  perform test.assert_eq(v_result2 ->> 'order_id', v_result ->> 'order_id',
    'criterio 5 · el id de la venta es el mismo');
  perform test.assert_eq(app.available_qty(v_tabla, v_salon), v_after,
    'criterio 5 · el stock no se descontó dos veces');

  -- ---------------------------------------------------------------------------
  -- Criterio 2: vender un combo virtual reduce todos sus componentes
  -- ---------------------------------------------------------------------------
  v_before   := app.available_qty(v_tabla, v_salon);
  v_before_p := app.available_qty(v_pinza, v_salon);

  v_result := create_instant_sale(
    p_items => jsonb_build_array(
      jsonb_build_object('variant_id', v_combo_v, 'quantity', 1, 'location_id', v_salon)
    ),
    p_payments => jsonb_build_array(
      jsonb_build_object('payment_method_id', test.method('efectivo'), 'amount', 36000)
    ),
    p_idempotency_key => 'test-combo-virtual'
  );

  perform test.assert_eq(v_before - app.available_qty(v_tabla, v_salon), 1::numeric,
    'criterio 2 · el combo virtual descuenta la tabla');
  perform test.assert_eq(v_before_p - app.available_qty(v_pinza, v_salon), 1::numeric,
    'criterio 2 · el combo virtual descuenta la pinza');
  perform test.assert_eq(app.on_hand_qty(v_combo_v, v_salon), 0::numeric,
    'criterio 2 · el combo virtual no tiene stock propio');

  -- ---------------------------------------------------------------------------
  -- Criterio 3: armar un combo prearmado consume componentes y aumenta el combo
  -- ---------------------------------------------------------------------------
  v_before   := app.available_qty(v_canasto, v_salon);
  v_before_p := app.on_hand_qty(v_combo_p, v_salon);
  -- La funda vive en el Altillo: primero se transfiere al Salón.
  perform transfer_stock(v_funda, v_altillo, v_salon, 2, 'Armado de combo');

  perform assemble_bundle(v_combo_p, v_salon, 2, 'Armado para vidriera');

  perform test.assert_eq(v_before - app.available_qty(v_canasto, v_salon), 2::numeric,
    'criterio 3 · armar consume los canastos');
  perform test.assert_eq(app.on_hand_qty(v_combo_p, v_salon) - v_before_p, 2::numeric,
    'criterio 3 · armar aumenta el stock del combo');

  -- Desarmar devuelve las piezas
  v_before := app.available_qty(v_canasto, v_salon);
  perform disassemble_bundle(v_combo_p, v_salon, 1, 'Se vendió suelto');
  perform test.assert_eq(app.available_qty(v_canasto, v_salon) - v_before, 1::numeric,
    'desarmar devuelve el canasto al stock');

  -- ---------------------------------------------------------------------------
  -- Criterio 6: un producto sin stock queda bloqueado para el empleado
  -- ---------------------------------------------------------------------------
  perform test.assert_raises(
    format($q$select create_instant_sale(
        jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 9999, 'location_id', %L)),
        jsonb_build_array(jsonb_build_object('payment_method_id', %L, 'amount', 1)))$q$,
      v_tabla, v_salon, test.method('efectivo')),
    'sin stock', 'criterio 6 · el empleado no puede vender sin stock');

  -- El empleado tampoco puede autorizarse la excepción.
  perform test.assert_raises(
    format($q$select create_instant_sale(
        jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 9999, 'location_id', %L)),
        jsonb_build_array(jsonb_build_object('payment_method_id', %L, 'amount', 1)),
        p_allow_oversell => true, p_oversell_reason => 'me lo pidió el cliente')$q$,
      v_tabla, v_salon, test.method('efectivo')),
    'dueño', 'criterio 6 · el empleado no puede autorizar la venta sin stock');

  -- ---------------------------------------------------------------------------
  -- Criterio 7: la salida online baja stock pero no aumenta venta ni caja
  -- ---------------------------------------------------------------------------
  v_before := app.available_qty(v_pinza, v_salon);
  select coalesce(sum(amount), 0) into v_drawer
    from cash_movements where session_id = v_session and affects_drawer;

  perform online_sale_exit(v_pinza, v_salon, 2, 'ecommerce', 'ML-12345', 'test-online-1');

  perform test.assert_eq(v_before - app.available_qty(v_pinza, v_salon), 2::numeric,
    'criterio 7 · la salida online descuenta stock');

  select coalesce(sum(amount), 0) into v_drawer2
    from cash_movements where session_id = v_session and affects_drawer;
  perform test.assert_eq(v_drawer2, v_drawer, 'criterio 7 · la salida online no toca la caja');
  perform test.assert_eq(
    (select count(*)::numeric from orders where organization_id = app.current_org_id()
       and created_at > now() - interval '1 minute' and total = 0), 0::numeric,
    'criterio 7 · la salida online no crea una venta');

  -- Idempotencia de la salida online
  perform online_sale_exit(v_pinza, v_salon, 2, 'ecommerce', 'ML-12345', 'test-online-1');
  perform test.assert_eq(v_before - app.available_qty(v_pinza, v_salon), 2::numeric,
    'criterio 7 · repetir la salida online no descuenta de nuevo');

  perform test.act_as_admin();
  raise notice 'Ventas y stock OK';
end $$;
