#!/usr/bin/env bash
# =============================================================================
# Criterio 4: dos ventas concurrentes no pueden consumir la misma última unidad.
# Necesita dos conexiones reales, así que vive fuera de los archivos .sql.
# =============================================================================
set -uo pipefail
DB="${PGDATABASE:-punto_madera}"
EMPLOYEE='44444444-4444-4444-4444-444444444442'

echo "Concurrencia"

# Producto de prueba con exactamente UNA unidad disponible en el Salón.
psql -d "$DB" -q -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_branch uuid := '22222222-2222-2222-2222-222222222222';
  v_salon uuid;
  v_prod uuid; v_variant uuid; v_mov uuid;
begin
  select id into v_salon from stock_locations where code = 'SALON';
  delete from product_variants where sku = 'TEST-CONC';

  insert into products (organization_id, kind, name, is_demo)
  values (v_org, 'simple', 'Producto concurrencia', true) returning id into v_prod;
  insert into product_variants (organization_id, product_id, sku, name, preferred_location_id, is_demo)
  values (v_org, v_prod, 'TEST-CONC', 'Única', v_salon, true) returning id into v_variant;
  insert into variant_prices (organization_id, variant_id, price_list_id, price)
  select v_org, v_variant, id, 1000 from price_lists where code = 'lista';

  v_mov := app.record_movement(v_org, v_branch, 'initial_inventory', 'test', null, 'Prueba de concurrencia');
  perform app.stock_in(v_mov, v_variant, v_salon, 1, 500);
end $$;
SQL

# Asegurar una caja abierta.
psql -d "$DB" -q -v ON_ERROR_STOP=1 <<SQL
select set_config('request.jwt.claims', '{"sub":"$EMPLOYEE"}', false) \g /dev/null
do \$\$
begin
  if app.current_cash_session() is null then
    perform open_cash_session((select id from cash_registers limit 1), 0);
  end if;
end \$\$;
SQL

SALE_SQL() {
  local key="$1" delay="$2"
  cat <<SQL
select set_config('request.jwt.claims', '{"sub":"$EMPLOYEE"}', false) \g /dev/null
begin;
select create_instant_sale(
  jsonb_build_array(jsonb_build_object(
    'variant_id', (select id from product_variants where sku='TEST-CONC'),
    'quantity', 1,
    'location_id', (select id from stock_locations where code='SALON'))),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id', (select id from payment_methods where code='efectivo'),
    'amount', 1000)),
  p_idempotency_key => '$key');
select pg_sleep($delay);
commit;
SQL
}

OUT_A=$(mktemp); OUT_B=$(mktemp)

# A toma el bloqueo del saldo y lo retiene 3 segundos antes de confirmar.
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f <(SALE_SQL conc-a 3) >"$OUT_A" 2>&1 &
PID_A=$!
sleep 1
# B intenta vender la misma unidad: queda esperando el bloqueo.
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f <(SALE_SQL conc-b 0) >"$OUT_B" 2>&1 &
PID_B=$!

wait $PID_A; RC_A=$?
wait $PID_B; RC_B=$?

SOLD=$(psql -d "$DB" -tAq -c "
  select coalesce(sum(oi.quantity),0)
    from order_items oi join orders o on o.id = oi.order_id
   where oi.sku_snapshot = 'TEST-CONC' and o.status <> 'cancelled';")
ONHAND=$(psql -d "$DB" -tAq -c "
  select coalesce(sum(on_hand),0) from inventory_balances
   where variant_id = (select id from product_variants where sku='TEST-CONC');")

FAILED=0
if [ "$RC_A" -eq 0 ] && [ "$RC_B" -eq 0 ]; then
  echo "  FALLA · criterio 4 · las dos ventas concurrentes tuvieron éxito"
  cat "$OUT_A" "$OUT_B"; FAILED=1
elif [ "$RC_A" -ne 0 ] && [ "$RC_B" -ne 0 ]; then
  echo "  FALLA · criterio 4 · ninguna de las dos ventas prosperó"
  cat "$OUT_A" "$OUT_B"; FAILED=1
else
  LOSER=$([ "$RC_A" -ne 0 ] && cat "$OUT_A" || cat "$OUT_B")
  if echo "$LOSER" | grep -qi "stock"; then
    echo "  ok · criterio 4 · exactamente una venta se quedó con la última unidad"
    echo "       la perdedora fue rechazada por falta de stock"
  else
    echo "  FALLA · criterio 4 · la venta perdedora falló por otro motivo:"
    echo "$LOSER"; FAILED=1
  fi
fi

if [ "$(echo "$SOLD" | tr -d ' ')" = "1.000" ] || [ "$(echo "$SOLD" | tr -d ' ')" = "1" ]; then
  echo "  ok · criterio 4 · se vendió exactamente 1 unidad (vendidas: $SOLD)"
else
  echo "  FALLA · criterio 4 · unidades vendidas: $SOLD (se esperaba 1)"; FAILED=1
fi

if [ "$(echo "$ONHAND" | tr -d ' ')" = "0.000" ] || [ "$(echo "$ONHAND" | tr -d ' ')" = "0" ]; then
  echo "  ok · criterio 4 · el stock no quedó negativo (queda: $ONHAND)"
else
  echo "  FALLA · criterio 4 · stock final inesperado: $ONHAND"; FAILED=1
fi

rm -f "$OUT_A" "$OUT_B"
[ "$FAILED" -eq 0 ] && echo "Concurrencia OK"
exit $FAILED
