-- =============================================================================
-- Criterios 28, 29, 30: el empleado no accede a costos ni márgenes,
-- ni por interfaz ni por consulta directa.
-- =============================================================================
\set ON_ERROR_STOP on
do $$
declare v_count int; v_owner_count int;
begin
  raise notice 'Permisos y aislamiento de costos';

  -- Como dueño: los costos existen y se ven.
  perform test.act_as(test.owner_id());
  select count(*) into v_owner_count from variant_costs;
  perform test.assert(v_owner_count > 0, 'el dueño ve los costos de las variantes');

  select count(*) into v_count from v_stock_aging;
  perform test.assert(v_count > 0, 'el dueño ve la antigüedad de stock valorizada');

  -- Como empleado: las mismas consultas devuelven cero filas (RLS, no UI).
  perform test.act_as(test.employee_id());

  select count(*) into v_count from variant_costs;
  perform test.assert_eq(v_count::numeric, 0::numeric, 'criterio 28 · el empleado no lee variant_costs');

  select count(*) into v_count from cost_history;
  perform test.assert_eq(v_count::numeric, 0::numeric, 'criterio 28 · el empleado no lee cost_history');

  select count(*) into v_count from inventory_lots;
  perform test.assert_eq(v_count::numeric, 0::numeric, 'criterio 28 · el empleado no lee lotes (costo unitario)');

  select count(*) into v_count from order_item_costs;
  perform test.assert_eq(v_count::numeric, 0::numeric, 'criterio 28 · el empleado no lee costos de venta');

  select count(*) into v_count from v_sale_margins;
  perform test.assert_eq(v_count::numeric, 0::numeric, 'criterio 28 · el empleado no lee la vista de márgenes');

  select count(*) into v_count from v_stock_aging;
  perform test.assert_eq(v_count::numeric, 0::numeric, 'criterio 28 · el empleado no lee stock valorizado');

  select count(*) into v_count from audit_logs;
  perform test.assert_eq(v_count::numeric, 0::numeric, 'el empleado no lee la auditoría');

  select count(*) into v_count from supplier_account_entries;
  perform test.assert_eq(v_count::numeric, 0::numeric, 'el empleado no ve deudas de proveedores');

  -- En cambio sí ve lo que necesita para vender.
  select count(*) into v_count from v_pos_catalog;
  perform test.assert(v_count > 0, 'el empleado ve el catálogo del punto de venta');
  select count(*) into v_count from variant_prices;
  perform test.assert(v_count > 0, 'el empleado ve los precios de venta');
  select count(*) into v_count from v_stock_by_location;
  perform test.assert(v_count > 0, 'el empleado ve el stock por ubicación');

  -- Escrituras vedadas
  perform test.assert_raises(
    format('insert into products (organization_id, name) values (%L, %L)',
           '11111111-1111-1111-1111-111111111111', 'Producto trucho'),
    'policy', 'el empleado no puede crear productos');

  -- Sin política de UPDATE, la RLS no lanza error: filtra las filas y el UPDATE
  -- no alcanza ninguna. Lo que hay que probar es que el precio NO cambió.
  declare v_before app.money; v_after app.money;
  begin
    perform test.act_as(test.owner_id());
    select price into v_before from variant_prices
     where variant_id = test.sku('PM-00003') and price_list_id = (select id from price_lists where code='lista');

    perform test.act_as(test.employee_id());
    update variant_prices set price = 1;

    perform test.act_as(test.owner_id());
    select price into v_after from variant_prices
     where variant_id = test.sku('PM-00003') and price_list_id = (select id from price_lists where code='lista');
    perform test.assert_eq(v_after, v_before, 'el empleado no puede cambiar precios directamente');
    perform test.act_as(test.employee_id());
  end;

  perform test.assert_raises(
    format('select set_variant_cost(%L, 999)', test.sku('PM-00003')),
    'dueño', 'el empleado no puede cambiar costos');

  perform test.assert_raises(
    format('select adjust_stock(%L, %L, 5, %L)', test.sku('PM-00003'), test.location('SALON'), 'porque sí'),
    'permiso denegado', 'el empleado no puede ajustar stock a mano');

  perform test.act_as_admin();
  raise notice 'Permisos OK';
end $$;
