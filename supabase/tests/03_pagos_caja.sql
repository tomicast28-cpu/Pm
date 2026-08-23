-- =============================================================================
-- Criterios 12, 13, 14, 17, 18, 19, 20, 29: pagos combinados, comisiones,
-- efectivo vs no efectivo, cierre de caja y descuentos auditados.
-- =============================================================================
\set ON_ERROR_STOP on
do $$
declare
  v_salon    uuid := test.location('SALON');
  v_canasto  uuid := test.sku('PM-00001');
  v_tabla    uuid := test.sku('PM-00003');
  v_register uuid;
  v_session  uuid;
  v_result   jsonb;
  v_close    jsonb;
  v_order    uuid;
  v_drawer_before app.money;
  v_drawer_after  app.money;
  v_paid     app.money;
  v_commission app.money;
  v_expected app.money;
  v_declared jsonb;
  v_disc     order_discounts;
  v_versions int;
begin
  raise notice 'Pagos y caja';
  perform test.act_as(test.employee_id());

  select id into v_register from cash_registers limit 1;
  select app.current_cash_session() into v_session;
  if v_session is null then
    v_session := open_cash_session(v_register, 20000);
  end if;

  -- ---------------------------------------------------------------------------
  -- Criterios 12, 13, 14: pago combinado, comisión y efecto sobre el cajón
  -- ---------------------------------------------------------------------------
  select coalesce(sum(amount), 0) into v_drawer_before
    from cash_movements where session_id = v_session and affects_drawer;

  -- Total 18.500. Se cobra 10.000 en efectivo + 8.500 con débito.
  v_result := create_instant_sale(
    p_items => jsonb_build_array(
      jsonb_build_object('variant_id', v_canasto, 'quantity', 1, 'location_id', v_salon)
    ),
    p_payments => jsonb_build_array(
      jsonb_build_object('payment_method_id', test.method('efectivo'), 'amount', 10000),
      jsonb_build_object('payment_method_id', test.method('debito'),   'amount', 8500)
    ),
    p_idempotency_key => 'test-combinado-1'
  );
  v_order := (v_result ->> 'order_id')::uuid;

  perform test.assert_eq((v_result ->> 'total')::numeric, 18500::numeric,
    'criterio 12 · el total de la venta');
  perform test.assert_eq((v_result ->> 'paid_total')::numeric, 18500::numeric,
    'criterio 12 · el pago combinado suma exactamente el total');
  perform test.assert_eq(v_result ->> 'payment_status', 'paid',
    'criterio 12 · la venta queda saldada');

  -- Criterio 13: comisión calculada por cada medio (débito 1,8%).
  select commission_amount into v_commission
    from payments where order_id = v_order and payment_method_id = test.method('debito');
  perform test.assert_eq(v_commission, round(8500 * 0.018, 2),
    'criterio 13 · comisión del débito calculada por su tasa');

  select commission_amount into v_commission
    from payments where order_id = v_order and payment_method_id = test.method('efectivo');
  perform test.assert_eq(v_commission, 0::numeric,
    'criterio 13 · el efectivo no tiene comisión');

  -- Criterio 14: solo el efectivo mueve el cajón.
  select coalesce(sum(amount), 0) into v_drawer_after
    from cash_movements where session_id = v_session and affects_drawer;
  perform test.assert_eq(v_drawer_after - v_drawer_before, 10000::numeric,
    'criterio 14 · solo los 10.000 en efectivo entran al cajón');

  perform test.assert_eq(
    (select count(*)::numeric from cash_movements
      where order_id = v_order and payment_method_id = test.method('debito') and affects_drawer),
    0::numeric, 'criterio 14 · el débito se concilia pero no toca el cajón');

  -- ---------------------------------------------------------------------------
  -- Vuelto: solo sobre medios que lo admiten, nunca negativo
  -- ---------------------------------------------------------------------------
  v_result := create_instant_sale(
    p_items => jsonb_build_array(
      jsonb_build_object('variant_id', v_canasto, 'quantity', 1, 'location_id', v_salon)
    ),
    p_payments => jsonb_build_array(
      jsonb_build_object('payment_method_id', test.method('efectivo'), 'amount', 20000)
    ),
    p_idempotency_key => 'test-vuelto-1'
  );
  perform test.assert_eq((v_result ->> 'change')::numeric, 1500::numeric,
    'el vuelto en efectivo se calcula sobre el excedente');
  perform test.assert_eq((v_result ->> 'paid_total')::numeric, 18500::numeric,
    'lo imputado al pedido excluye el vuelto');

  -- Excedente en un medio que no admite vuelto: rechazado.
  perform test.assert_raises(
    format($q$select create_instant_sale(
        jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 1, 'location_id', %L)),
        jsonb_build_array(jsonb_build_object('payment_method_id', %L, 'amount', 30000)))$q$,
      v_canasto, v_salon, test.method('debito')),
    'vuelto', 'no se admite excedente en un medio sin vuelto');

  -- ---------------------------------------------------------------------------
  -- Criterio 29: el descuento del empleado queda auditado
  -- ---------------------------------------------------------------------------
  v_result := create_instant_sale(
    p_items => jsonb_build_array(
      jsonb_build_object('variant_id', v_tabla, 'quantity', 1, 'location_id', v_salon,
                         'discount_amount', 3200, 'discount_reason', 'Cliente frecuente')
    ),
    p_payments => jsonb_build_array(
      jsonb_build_object('payment_method_id', test.method('efectivo'), 'amount', 28800)
    ),
    p_idempotency_key => 'test-descuento-1'
  );
  v_order := (v_result ->> 'order_id')::uuid;

  select * into v_disc from order_discounts where order_id = v_order and scope = 'line';
  perform test.assert(v_disc.id is not null, 'criterio 29 · el descuento quedó registrado');
  perform test.assert_eq(v_disc.original_price, 32000::numeric,
    'criterio 29 · guarda el precio original');
  perform test.assert_eq(v_disc.final_price, 28800::numeric,
    'criterio 29 · guarda el precio final');
  perform test.assert_eq(v_disc.discount_amount, 3200::numeric,
    'criterio 29 · guarda el importe descontado');
  perform test.assert_eq(round(v_disc.discount_rate, 4), 0.1000::numeric,
    'criterio 29 · guarda el porcentaje');
  perform test.assert_eq(v_disc.created_by, test.employee_id(),
    'criterio 29 · guarda qué empleado lo hizo');
  perform test.assert_eq(v_disc.reason, 'Cliente frecuente',
    'criterio 29 · guarda el motivo');

  -- ---------------------------------------------------------------------------
  -- Criterios 17, 18: el cierre muestra esperado/declarado y exige motivo
  -- ---------------------------------------------------------------------------
  select expected_amount into v_expected
    from app.cash_session_expected(v_session)
   where payment_method_id = test.method('efectivo');
  perform test.assert(v_expected > 0, 'criterio 17 · el cierre calcula el efectivo esperado');

  -- Declarar de menos sin explicar: rechazado.
  select jsonb_object_agg(payment_method_id::text,
                          jsonb_build_object('amount', expected_amount))
    into v_declared
    from app.cash_session_expected(v_session);

  perform test.assert_raises(
    format('select close_cash_session(%L, %L::jsonb)', v_session,
           jsonb_set(v_declared, array[test.method('efectivo')::text, 'amount'],
                     to_jsonb(v_expected - 500))::text),
    'motivo', 'criterio 18 · una diferencia sin motivo es rechazada');

  -- Con motivo, cierra.
  v_close := close_cash_session(
    v_session,
    jsonb_set(
      jsonb_set(v_declared, array[test.method('efectivo')::text, 'amount'], to_jsonb(v_expected - 500)),
      array[test.method('efectivo')::text, 'reason'], '"Faltante de caja, se repone mañana"'::jsonb),
    'Cierre de prueba'
  );

  perform test.assert_eq((v_close ->> 'cash_difference')::numeric, -500::numeric,
    'criterio 18 · la diferencia declarada queda registrada');
  perform test.assert_eq((select status from cash_sessions where id = v_session), 'closed',
    'criterio 17 · la caja queda cerrada');

  -- La caja cerrada no admite más cobros.
  perform test.assert_raises(
    format($q$select create_instant_sale(
        jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 1, 'location_id', %L)),
        jsonb_build_array(jsonb_build_object('payment_method_id', %L, 'amount', 18500)))$q$,
      v_canasto, v_salon, test.method('efectivo')),
    'caja abierta', 'una caja cerrada no admite cobros');

  -- ---------------------------------------------------------------------------
  -- Criterios 19, 20: reapertura solo del dueño, conservando el cierre original
  -- ---------------------------------------------------------------------------
  perform test.assert_raises(
    format('select reopen_cash_session(%L, %L)', v_session, 'me equivoqué'),
    'dueño', 'criterio 19 · el empleado no puede reabrir la caja');

  perform test.act_as(test.owner_id());
  perform test.assert_raises(
    format('select reopen_cash_session(%L, %L)', v_session, ''),
    'motivo', 'la reapertura exige motivo');

  perform reopen_cash_session(v_session, 'Faltaba registrar una venta');
  perform test.assert_eq((select status from cash_sessions where id = v_session), 'open',
    'criterio 20 · el dueño puede reabrir');

  select count(*)::int into v_versions
    from cash_close_breakdowns where session_id = v_session and close_version = 1;
  perform test.assert(v_versions > 0,
    'criterio 20 · el cierre original se conserva con su versión');

  perform test.assert_eq(
    (select reopened_count::numeric from cash_sessions where id = v_session), 1::numeric,
    'criterio 20 · la reapertura queda contabilizada');

  perform test.assert(
    exists (select 1 from audit_logs where entity = 'cash_session'
              and entity_id = v_session::text and action = 'reopen_cash_session'),
    'criterio 20 · la reapertura queda auditada');

  perform test.act_as_admin();
  raise notice 'Pagos y caja OK';
end $$;
