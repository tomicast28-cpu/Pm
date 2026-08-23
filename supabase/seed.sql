-- =============================================================================
-- Datos semilla de Punto Madera.
--
-- Todo lo que se crea acá queda marcado con `is_demo = true` y cuelga de una
-- organización demo, de modo que `select app.purge_demo_data()` lo borra entero
-- antes de salir a producción (checklist 36).
-- =============================================================================

begin;

do $$
declare
  v_org       uuid := '11111111-1111-1111-1111-111111111111';
  v_branch    uuid := '22222222-2222-2222-2222-222222222222';
  v_salon     uuid := '33333333-3333-3333-3333-333333333331';
  v_altillo   uuid := '33333333-3333-3333-3333-333333333332';
  v_owner     uuid := '44444444-4444-4444-4444-444444444441';
  v_employee  uuid := '44444444-4444-4444-4444-444444444442';
  v_register  uuid := '55555555-5555-5555-5555-555555555551';

  v_pl_lista  uuid := '66666666-6666-6666-6666-666666666661';
  v_pl_transf uuid := '66666666-6666-6666-6666-666666666662';
  v_pl_mayor  uuid := '66666666-6666-6666-6666-666666666663';
  v_pl_tarjeta uuid := '66666666-6666-6666-6666-666666666664';

  v_supplier  uuid := '77777777-7777-7777-7777-777777777771';
  v_cat       record;
  v_prod      uuid;
  v_variant   uuid;
  v_mov       uuid;

  -- Variantes que necesitamos referenciar después
  v_canasto_negro uuid;
  v_canasto_blanco uuid;
  v_tabla     uuid;
  v_funda     uuid;
  v_pinza     uuid;
  v_combo_v   uuid;
  v_combo_p   uuid;
  v_grabado   uuid;
  v_envio     uuid;
begin
  -- ---------------------------------------------------------------------------
  -- Organización, sucursal y ubicaciones
  -- ---------------------------------------------------------------------------
  insert into organizations (id, name, legal_name, is_demo)
  values (v_org, 'Punto Madera', 'Punto Madera', true);

  insert into branches (id, organization_id, name, address, is_demo)
  values (v_branch, v_org, 'Local principal', 'Av. Siempreviva 742', true);

  insert into stock_locations (id, organization_id, branch_id, code, name, sellable, is_default, sort_order, is_demo)
  values
    (v_salon,   v_org, v_branch, 'SALON',   'Salón',   true,  true,  1, true),
    (v_altillo, v_org, v_branch, 'ALTILLO', 'Altillo', true,  false, 2, true);

  insert into business_settings (organization_id) values (v_org);
  insert into brand_settings (organization_id, phone, instagram, address)
  values (v_org, '11 5555-5555', '@puntomadera', 'Av. Siempreviva 742');

  -- Numeración de documentos
  insert into document_sequences (organization_id, branch_id, kind, prefix, padding, next_value)
  values
    (v_org, v_branch, 'sale',         'V-',  6, 1),
    (v_org, v_branch, 'cash_session', 'C-',  5, 1),
    (v_org, v_branch, 'quote',        'P-',  6, 1),
    (v_org, v_branch, 'fulfillment',  'R-',  6, 1),
    (v_org, v_branch, 'delivery',     'E-',  6, 1),
    (v_org, v_branch, 'receipt',      'CM-', 6, 1),
    (v_org, v_branch, 'return',       'D-',  6, 1),
    (v_org, null,     'sku',          'PM-', 5, 1);

  -- ---------------------------------------------------------------------------
  -- Usuarios: dueño y empleado (auth.users local; en Supabase los crea Auth)
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (v_owner,    'dueno@puntomadera.test',    '{"full_name":"Dueño Punto Madera"}'::jsonb),
    (v_employee, 'empleado@puntomadera.test', '{"full_name":"Empleado Mostrador"}'::jsonb)
  on conflict (id) do nothing;

  insert into user_profiles (id, organization_id, branch_id, full_name, role, email, is_demo)
  values
    (v_owner,    v_org, v_branch, 'Dueño Punto Madera',  'owner',    'dueno@puntomadera.test', true),
    (v_employee, v_org, v_branch, 'Empleado Mostrador',  'employee', 'empleado@puntomadera.test', true);

  insert into employee_profiles (organization_id, user_id, hired_at, is_demo)
  values (v_org, v_employee, current_date - 200, true);

  -- Permisos del empleado (5.2). Lo no listado queda denegado.
  insert into role_permissions (organization_id, role, permission, granted)
  values
    (v_org, 'employee', 'sales.create',       true),
    (v_org, 'employee', 'payments.create',    true),
    (v_org, 'employee', 'customers.manage',   true),
    (v_org, 'employee', 'cash.open',          true),
    (v_org, 'employee', 'cash.close',         true),
    (v_org, 'employee', 'cash.movement',      true),
    (v_org, 'employee', 'stock.transfer',     true),
    (v_org, 'employee', 'stock.online_exit',  true),
    (v_org, 'employee', 'stock.assemble',     true),
    (v_org, 'employee', 'orders.manage',      true),
    (v_org, 'employee', 'fulfillments.manage',true),
    (v_org, 'employee', 'posters.manage',     true),
    -- Explícitamente denegados
    (v_org, 'employee', 'costs.view',         false),
    (v_org, 'employee', 'reports.view',       false),
    (v_org, 'employee', 'catalog.manage',     false),
    (v_org, 'employee', 'prices.manage',      false),
    (v_org, 'employee', 'stock.adjust',       false),
    (v_org, 'employee', 'sales.reverse',      false),
    (v_org, 'employee', 'cash.reopen',        false),
    (v_org, 'employee', 'settings.manage',    false),
    (v_org, 'employee', 'suppliers.manage',   false);

  -- ---------------------------------------------------------------------------
  -- Medios de pago
  -- ---------------------------------------------------------------------------
  insert into payment_methods (
    organization_id, code, name, affects_cash_drawer, requires_confirmation,
    commission_rate, settlement_days, allows_change, is_account_credit, sort_order, is_demo
  )
  values
    (v_org, 'efectivo',     'Efectivo',           true,  false, 0,      0, true,  false, 1, true),
    (v_org, 'transferencia','Transferencia',      false, true,  0,      0, false, false, 2, true),
    (v_org, 'mercadopago',  'Mercado Pago',       false, false, 0.0349, 1, false, false, 3, true),
    (v_org, 'qr',           'QR',                 false, true,  0.008,  1, false, false, 4, true),
    (v_org, 'debito',       'Débito',             false, false, 0.018,  1, false, false, 5, true),
    (v_org, 'credito',      'Crédito',            false, false, 0.021,  18,false, false, 6, true),
    (v_org, 'cuotas',       'Crédito en cuotas',  false, false, 0.065,  18,false, false, 7, true),
    (v_org, 'cuentadni',    'Cuenta DNI',         false, false, 0,      1, false, false, 8, true),
    (v_org, 'ctacte',       'Cuenta corriente',   false, false, 0,      0, false, true,  9, true);

  insert into sales_channels (organization_id, code, name, is_external, is_demo)
  values
    (v_org, 'local',     'Local',           false, true),
    (v_org, 'instagram', 'Instagram',       false, true),
    (v_org, 'whatsapp',  'WhatsApp',        false, true),
    (v_org, 'mayorista', 'Mayorista',       false, true),
    (v_org, 'ecommerce', 'Venta online',    true,  true);

  -- ---------------------------------------------------------------------------
  -- Listas de precio
  -- ---------------------------------------------------------------------------
  insert into price_lists (id, organization_id, code, name, derived_from_id, adjustment_rate, rounding, is_default, is_wholesale, sort_order, is_demo)
  values
    (v_pl_lista,   v_org, 'lista',         'Lista',                  null,       0,      'none', true,  false, 1, true),
    (v_pl_transf,  v_org, 'transferencia', 'Transferencia/efectivo', v_pl_lista, -0.10,  'ten',  false, false, 2, true),
    (v_pl_mayor,   v_org, 'mayorista',     'Mayorista',              v_pl_lista, -0.25,  'ten',  false, true,  3, true),
    (v_pl_tarjeta, v_org, 'tarjeta',       'Tarjeta/cuotas',         v_pl_lista,  0.15,  'ten',  false, false, 4, true);

  -- ---------------------------------------------------------------------------
  -- Caja y gastos
  -- ---------------------------------------------------------------------------
  insert into cash_registers (id, organization_id, branch_id, name, is_demo)
  values (v_register, v_org, v_branch, 'Caja mostrador', true);

  insert into expense_categories (organization_id, name, is_demo)
  values (v_org, 'Servicios', true), (v_org, 'Insumos', true),
         (v_org, 'Fletes', true), (v_org, 'Varios', true);

  -- ---------------------------------------------------------------------------
  -- Categorías
  -- ---------------------------------------------------------------------------
  insert into categories (organization_id, name, sort_order, is_demo)
  values
    (v_org, 'Organizadores', 1, true), (v_org, 'Canastos', 2, true),
    (v_org, 'Fundas', 3, true),        (v_org, 'Cortinas', 4, true),
    (v_org, 'Iluminación', 5, true),   (v_org, 'Tablas', 6, true),
    (v_org, 'Parrilla', 7, true),      (v_org, 'Combos', 8, true),
    (v_org, 'Servicios', 9, true);

  -- ---------------------------------------------------------------------------
  -- Proveedor y clientes
  -- ---------------------------------------------------------------------------
  insert into suppliers (id, organization_id, name, contact_name, phone, payment_terms, lead_time_days, is_demo)
  values (v_supplier, v_org, 'Maderas del Sur', 'Ricardo', '11 4444-4444', '30 días', 10, true);

  insert into customers (organization_id, name, customer_type, is_walk_in, is_demo)
  values (v_org, 'Consumidor final', 'retail', true, true);

  insert into customers (organization_id, name, customer_type, phone, email, document_type, document_number, is_demo)
  values (v_org, 'Marina López', 'retail', '11 6666-6666', 'marina@ejemplo.test', 'DNI', '30111222', true);

  insert into customers (organization_id, name, customer_type, phone, document_type, document_number,
                         price_list_id, credit_limit, credit_enabled, payment_term_days, is_demo)
  values (v_org, 'Deco Mayorista SRL', 'wholesale', '11 7777-7777', 'CUIT', '30-71234567-9',
          v_pl_mayor, 500000, true, 30, true);

  -- ---------------------------------------------------------------------------
  -- Catálogo
  -- ---------------------------------------------------------------------------

  -- Producto con variantes: Canasto de zuncho
  select id into v_cat from categories where organization_id = v_org and name = 'Canastos';
  insert into products (organization_id, category_id, kind, name, short_description, is_handcrafted, is_demo)
  values (v_org, v_cat.id, 'variant', 'Canasto de zuncho', 'Canasto tejido a mano en zuncho', true, true)
  returning id into v_prod;

  insert into product_variants (organization_id, product_id, sku, name, attributes, min_stock, preferred_location_id, is_demo)
  values (v_org, v_prod, 'PM-00001', 'Negro 30x20x15',
          '{"color":"Negro","medida":"30x20x15","material":"Zuncho"}'::jsonb, 3, v_salon, true)
  returning id into v_canasto_negro;

  insert into product_variants (organization_id, product_id, sku, name, attributes, min_stock, preferred_location_id, is_demo)
  values (v_org, v_prod, 'PM-00002', 'Blanco 30x20x15',
          '{"color":"Blanco","medida":"30x20x15","material":"Zuncho"}'::jsonb, 3, v_salon, true)
  returning id into v_canasto_blanco;

  -- Producto simple: Tabla de asado
  select id into v_cat from categories where organization_id = v_org and name = 'Tablas';
  insert into products (organization_id, category_id, kind, name, short_description, is_handcrafted, is_demo)
  values (v_org, v_cat.id, 'simple', 'Tabla de asado', 'Tabla de algarrobo con cantoneras', true, true)
  returning id into v_prod;
  insert into product_variants (organization_id, product_id, sku, name, attributes, min_stock, preferred_location_id, is_demo)
  values (v_org, v_prod, 'PM-00003', '40x30', '{"medida":"40x30","material":"Algarrobo"}'::jsonb, 2, v_salon, true)
  returning id into v_tabla;

  -- Producto simple: Funda de tela
  select id into v_cat from categories where organization_id = v_org and name = 'Fundas';
  insert into products (organization_id, category_id, kind, name, is_demo)
  values (v_org, v_cat.id, 'simple', 'Funda de lino', true)
  returning id into v_prod;
  insert into product_variants (organization_id, product_id, sku, name, min_stock, preferred_location_id, is_demo)
  values (v_org, v_prod, 'PM-00004', 'Natural', 2, v_altillo, true)
  returning id into v_funda;

  -- Producto simple: Pinza de parrilla
  select id into v_cat from categories where organization_id = v_org and name = 'Parrilla';
  insert into products (organization_id, category_id, kind, name, is_demo)
  values (v_org, v_cat.id, 'simple', 'Pinza de parrilla', true)
  returning id into v_prod;
  insert into product_variants (organization_id, product_id, sku, name, min_stock, preferred_location_id, is_demo)
  values (v_org, v_prod, 'PM-00005', 'Acero', 2, v_salon, true)
  returning id into v_pinza;

  -- Combo VIRTUAL: no tiene stock propio, se resuelve en sus piezas.
  select id into v_cat from categories where organization_id = v_org and name = 'Combos';
  insert into products (organization_id, category_id, kind, name, short_description, is_demo)
  values (v_org, v_cat.id, 'bundle_virtual', 'Combo Asador', 'Tabla + pinza', true)
  returning id into v_prod;
  insert into product_variants (organization_id, product_id, sku, name, preferred_location_id, is_demo)
  values (v_org, v_prod, 'PM-00006', 'Combo Asador', v_salon, true)
  returning id into v_combo_v;
  insert into bundle_components (organization_id, bundle_variant_id, component_variant_id, quantity)
  values (v_org, v_combo_v, v_tabla, 1), (v_org, v_combo_v, v_pinza, 1);

  -- Combo PREARMADO: tiene stock propio; se arma consumiendo componentes.
  insert into products (organization_id, category_id, kind, name, short_description, is_demo)
  values (v_org, v_cat.id, 'bundle_stocked', 'Combo Organizador', 'Canasto negro + funda', true)
  returning id into v_prod;
  insert into product_variants (organization_id, product_id, sku, name, preferred_location_id, is_demo)
  values (v_org, v_prod, 'PM-00007', 'Combo Organizador', v_salon, true)
  returning id into v_combo_p;
  insert into bundle_components (organization_id, bundle_variant_id, component_variant_id, quantity)
  values (v_org, v_combo_p, v_canasto_negro, 1), (v_org, v_combo_p, v_funda, 1);

  -- Servicios: no descuentan stock.
  select id into v_cat from categories where organization_id = v_org and name = 'Servicios';
  insert into products (organization_id, category_id, kind, name, is_inventoried, requires_customization, is_demo)
  values (v_org, v_cat.id, 'service', 'Grabado', false, true, true)
  returning id into v_prod;
  insert into product_variants (organization_id, product_id, sku, name, is_demo)
  values (v_org, v_prod, 'PM-00008', 'Grabado láser', true)
  returning id into v_grabado;

  insert into products (organization_id, category_id, kind, name, is_inventoried, is_demo)
  values (v_org, v_cat.id, 'service', 'Envío', false, true)
  returning id into v_prod;
  insert into product_variants (organization_id, product_id, sku, name, is_demo)
  values (v_org, v_prod, 'PM-00009', 'Envío a domicilio', true)
  returning id into v_envio;

  -- Ajustar la secuencia de SKU al último usado.
  update document_sequences set next_value = 10 where organization_id = v_org and kind = 'sku';

  -- ---------------------------------------------------------------------------
  -- Precios (lista base; las demás listas se derivan por porcentaje)
  -- ---------------------------------------------------------------------------
  insert into variant_prices (organization_id, variant_id, price_list_id, price, tax_rate)
  values
    (v_org, v_canasto_negro,  v_pl_lista, 18500.00, 0.21),
    (v_org, v_canasto_blanco, v_pl_lista, 18500.00, 0.21),
    (v_org, v_tabla,          v_pl_lista, 32000.00, 0.21),
    (v_org, v_funda,          v_pl_lista,  9800.00, 0.21),
    (v_org, v_pinza,          v_pl_lista,  7400.00, 0.21),
    (v_org, v_combo_v,        v_pl_lista, 36000.00, 0.21),
    (v_org, v_combo_p,        v_pl_lista, 25900.00, 0.21),
    (v_org, v_grabado,        v_pl_lista,  4500.00, 0.21),
    (v_org, v_envio,          v_pl_lista,  6000.00, 0.21);

  -- ---------------------------------------------------------------------------
  -- Costos (solo visibles para el dueño)
  -- ---------------------------------------------------------------------------
  update variant_costs set last_cost = 9200.00,  average_cost = 9200.00,  last_cost_at = now(), last_supplier_id = v_supplier where variant_id = v_canasto_negro;
  update variant_costs set last_cost = 9200.00,  average_cost = 9200.00,  last_cost_at = now(), last_supplier_id = v_supplier where variant_id = v_canasto_blanco;
  update variant_costs set last_cost = 16400.00, average_cost = 16400.00, last_cost_at = now(), last_supplier_id = v_supplier where variant_id = v_tabla;
  update variant_costs set last_cost = 4900.00,  average_cost = 4900.00,  last_cost_at = now(), last_supplier_id = v_supplier where variant_id = v_funda;
  update variant_costs set last_cost = 3600.00,  average_cost = 3600.00,  last_cost_at = now(), last_supplier_id = v_supplier where variant_id = v_pinza;
  update variant_costs set last_cost = 1200.00,  average_cost = 1200.00 where variant_id = v_grabado;

  -- ---------------------------------------------------------------------------
  -- Stock inicial mediante movimientos reales (nunca escribiendo saldos a mano)
  -- ---------------------------------------------------------------------------
  v_mov := app.record_movement(v_org, v_branch, 'initial_inventory', 'seed', null,
                               'Inventario inicial de datos demo');

  perform app.stock_in(v_mov, v_canasto_negro,  v_salon,   8,  9200.00,  'available', v_supplier, null, now() - interval '120 days');
  perform app.stock_in(v_mov, v_canasto_negro,  v_altillo, 12, 9400.00,  'available', v_supplier, null, now() - interval '20 days');
  perform app.stock_in(v_mov, v_canasto_blanco, v_salon,   5,  9200.00,  'available', v_supplier, null, now() - interval '200 days');
  perform app.stock_in(v_mov, v_tabla,          v_salon,   6,  16400.00, 'available', v_supplier, null, now() - interval '15 days');
  perform app.stock_in(v_mov, v_tabla,          v_altillo, 4,  16800.00, 'available', v_supplier, null, now() - interval '5 days');
  perform app.stock_in(v_mov, v_funda,          v_altillo, 10, 4900.00,  'available', v_supplier, null, now() - interval '45 days');
  perform app.stock_in(v_mov, v_pinza,          v_salon,   9,  3600.00,  'available', v_supplier, null, now() - interval '70 days');
  perform app.stock_in(v_mov, v_combo_p,        v_salon,   2,  14100.00, 'available', null, null, now() - interval '10 days');

  perform app.recalc_average_cost(v_canasto_negro);
  perform app.recalc_average_cost(v_tabla);

  -- ---------------------------------------------------------------------------
  -- Plantillas de cartel del sistema (20.3)
  -- ---------------------------------------------------------------------------
  insert into poster_templates (organization_id, code, name, description, is_system, sort_order, config)
  values
    (null, 'oferta_fuerte', 'Oferta fuerte', 'Bloque de color con OFERTA en blanco', true, 1,
     '{"headline":"OFERTA","band":"accent","showOldPrice":true,"showTransferPrice":true}'::jsonb),
    (null, 'liquidacion',   'Liquidación',   'Para vaciar stock clavado', true, 2,
     '{"headline":"LIQUIDACIÓN","band":"dark","showOldPrice":true,"showPercent":true}'::jsonb),
    (null, 'nuevo_ingreso', 'Nuevo ingreso', 'Producto recién llegado', true, 3,
     '{"headline":"NUEVO","band":"primary","showOldPrice":false}'::jsonb),
    (null, 'transferencia', 'Precio transferencia', 'Destaca el precio por transferencia', true, 4,
     '{"headline":"PRECIO TRANSFERENCIA","band":"primary","showTransferPrice":true}'::jsonb),
    (null, 'combo',         'Combo',         'Combo con detalle de piezas', true, 5,
     '{"headline":"COMBO","band":"accent","showComponents":true}'::jsonb),
    (null, 'mayorista',     'Mayorista',     'Precio por cantidad', true, 6,
     '{"headline":"MAYORISTA","band":"dark","showWholesale":true}'::jsonb),
    (null, 'elegante',      'Elegante',      'Sobrio, sin gritar oferta', true, 7,
     '{"headline":"","band":"light","showOldPrice":false}'::jsonb),
    (null, 'etiqueta',      'Etiqueta de estante', 'Etiquetas recortables A4', true, 8,
     '{"headline":"","band":"none","compact":true}'::jsonb);

  raise notice 'Datos demo cargados para la organización %', v_org;
end $$;

commit;
