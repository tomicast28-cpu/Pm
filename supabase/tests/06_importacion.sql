-- =============================================================================
-- Importación de catálogo: aplica, no sobrescribe en silencio, y se puede
-- revertir mientras no haya movimientos posteriores (21.3).
-- =============================================================================
\set ON_ERROR_STOP on
do $$
declare
  v_salon   uuid := test.location('SALON');
  v_result  jsonb;
  v_job     uuid;
  v_variant uuid;
  v_rows    jsonb;
  v_bundles jsonb;
  v_before  int;
begin
  raise notice 'Importación de catálogo';

  v_rows := jsonb_build_array(
    jsonb_build_object(
      'fila', 2, 'nombre', 'Portavelas de quebracho', 'categoria', 'Iluminación',
      'variante', 'Chico', 'atributos', jsonb_build_object('medida', '10x10'),
      'sku', 'IMP-0001', 'codigo_barras', null, 'proveedor', 'Taller Nuevo',
      'costo', '2400.00', 'precio_lista', '5900.00',
      'precio_transferencia', null, 'precio_mayorista', null,
      'stock_salon', 6, 'stock_altillo', 0, 'stock_minimo', 2,
      'tipo', 'simple', 'activo', true),
    jsonb_build_object(
      'fila', 3, 'nombre', 'Portavelas de quebracho', 'categoria', 'Iluminación',
      'variante', 'Grande', 'atributos', jsonb_build_object('medida', '20x20'),
      'sku', 'IMP-0002', 'codigo_barras', null, 'proveedor', 'Taller Nuevo',
      'costo', '3900.00', 'precio_lista', '8900.00',
      'precio_transferencia', null, 'precio_mayorista', null,
      'stock_salon', 4, 'stock_altillo', 3, 'stock_minimo', 2,
      'tipo', 'simple', 'activo', true),
    -- Un SKU que YA existe: debe omitirse sin pisar el producto original.
    jsonb_build_object(
      'fila', 4, 'nombre', 'Intento de pisar', 'categoria', 'Canastos',
      'variante', 'X', 'atributos', '{}'::jsonb,
      'sku', 'PM-00001', 'codigo_barras', null, 'proveedor', null,
      'costo', '1.00', 'precio_lista', '1.00',
      'precio_transferencia', null, 'precio_mayorista', null,
      'stock_salon', 0, 'stock_altillo', 0, 'stock_minimo', 0,
      'tipo', 'simple', 'activo', true)
  );

  v_bundles := '[]'::jsonb;

  -- El empleado no puede importar.
  perform test.act_as(test.employee_id());
  perform test.assert_raises(
    format('select apply_catalog_import(%L::jsonb)', v_rows::text),
    'permiso denegado', 'el empleado no puede importar el catálogo');

  -- El dueño sí.
  perform test.act_as(test.owner_id());
  select count(*)::int into v_before from product_variants;

  v_result := apply_catalog_import(v_rows, v_bundles, 'catalogo-prueba.xlsx');
  v_job := (v_result ->> 'job_id')::uuid;

  perform test.assert_eq((v_result ->> 'creadas')::numeric, 2::numeric,
    'importa las 2 filas nuevas');
  perform test.assert_eq((v_result ->> 'omitidas')::numeric, 1::numeric,
    'omite el SKU que ya existía');

  -- No sobrescribió el producto original.
  perform test.assert_eq(
    (select p.name from product_variants v join products p on p.id = v.product_id
      where v.sku = 'PM-00001'),
    'Canasto de zuncho', 'el SKU existente no fue sobrescrito');

  -- Creó precios, costos y stock real.
  select id into v_variant from product_variants where sku = 'IMP-0001';
  perform test.assert_eq(
    app.effective_price(v_variant, (select id from price_lists where code = 'lista')),
    5900.00::numeric, 'cargó el precio de lista');
  perform test.assert_eq(
    (select last_cost from variant_costs where variant_id = v_variant),
    2400.00::numeric, 'cargó el costo');
  perform test.assert_eq(app.available_qty(v_variant, v_salon), 6::numeric,
    'ingresó el stock inicial en el Salón');

  -- El stock inicial entró como movimiento, no como escritura de saldos.
  perform test.assert(
    exists (select 1 from inventory_movements
             where reference_type = 'import' and reference_id = v_job),
    'el stock inicial quedó como movimiento de inventario');

  -- El precio derivado de transferencia se calcula solo (5.900 − 10% = 5.310).
  perform test.assert_eq(
    app.effective_price(v_variant, (select id from price_lists where code = 'transferencia')),
    5310.00::numeric, 'la lista de transferencia se deriva sola');

  -- Creó la categoría y el proveedor que no existían.
  perform test.assert(
    exists (select 1 from categories where name = 'Iluminación'),
    'usó la categoría indicada');
  perform test.assert(
    exists (select 1 from suppliers where name = 'Taller Nuevo'),
    'creó el proveedor que no existía');

  -- Reversión: exige motivo y es facultad del dueño.
  perform test.assert_raises(
    format('select revert_catalog_import(%L, %L)', v_job, ''),
    'motivo', 'revertir una importación exige motivo');

  v_result := revert_catalog_import(v_job, 'Vino con la lista de precios vieja');
  perform test.assert_eq((v_result ->> 'eliminadas')::numeric, 2::numeric,
    'la reversión elimina lo que creó');
  perform test.assert_eq((select count(*)::numeric from product_variants), v_before::numeric,
    'el catálogo vuelve a su estado anterior');
  perform test.assert_eq(
    (select status from import_jobs where id = v_job), 'reverted',
    'la importación queda marcada como revertida');

  -- Una importación cuyos productos ya se vendieron NO se puede revertir.
  v_result := apply_catalog_import(
    jsonb_build_array(jsonb_build_object(
      'fila', 2, 'nombre', 'Bandeja importada', 'categoria', 'Tablas',
      'variante', 'Única', 'atributos', '{}'::jsonb,
      'sku', 'IMP-0009', 'codigo_barras', null, 'proveedor', null,
      'costo', '1000.00', 'precio_lista', '2500.00',
      'precio_transferencia', null, 'precio_mayorista', null,
      'stock_salon', 5, 'stock_altillo', 0, 'stock_minimo', 1,
      'tipo', 'simple', 'activo', true)),
    '[]'::jsonb, 'catalogo-vendido.xlsx');
  v_job := (v_result ->> 'job_id')::uuid;

  -- Se transfiere una unidad: ya hay historia posterior.
  perform transfer_stock(test.sku('IMP-0009'), v_salon, test.location('ALTILLO'), 1, 'Prueba');

  perform test.assert_raises(
    format('select revert_catalog_import(%L, %L)', v_job, 'quiero deshacer'),
    'movimientos posteriores',
    'no se revierte una importación cuyos productos ya se movieron');

  perform test.act_as_admin();
  raise notice 'Importación OK';
end $$;
