-- =============================================================================
-- 0010 — Row Level Security.
--
-- Reglas de la casa:
--  1. TODA tabla de `public` tiene RLS habilitada.
--  2. Sin política = sin acceso. Las tablas de libro contable (stock, caja,
--     pagos, cuentas) NO tienen políticas de escritura: solo pueden modificarlas
--     las funciones `SECURITY DEFINER` de 0011–0015. Esto hace imposible que el
--     navegador eluda las reglas de negocio, aunque conozca la clave anónima.
--  3. Las tablas que contienen costo o margen solo son legibles por el dueño.
--     Es una restricción de base, no de interfaz (criterio de aceptación 28).
-- =============================================================================

-- Supabase expone las tablas vía PostgREST con el rol `authenticated`.
-- El GRANT abre la puerta; la RLS decide quién pasa.
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app to anon, authenticated, service_role;

do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.tablename);
    execute format('grant select on public.%I to anon', r.tablename);
  end loop;
end $$;

do $$
begin
  execute 'grant all on all sequences in schema public to authenticated, service_role';
end $$;

-- -----------------------------------------------------------------------------
-- Lectura para miembros de la organización.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  member_read text[] := array[
    'branches','stock_locations','business_settings','brand_settings',
    'payment_methods','sales_channels','document_sequences',
    'categories','products','product_variants','product_images','bundle_components',
    'price_lists','variant_prices',
    'inventory_movements','inventory_movement_items','inventory_balances',
    'stock_reservations','inventory_counts','inventory_count_items',
    'customers','orders','order_items','order_discounts',
    'payments','payment_allocations','fulfillments','fulfillment_items',
    'returns','return_items','lost_sales','visitor_counts','manual_invoices','attachments',
    'cash_registers','cash_sessions','cash_movements','cash_close_breakdowns',
    'expenses','expense_categories',
    'suppliers','supplier_incidents',
    'delivery_zones','deliveries','delivery_items',
    'employee_tasks','import_jobs','import_job_rows','posters','poster_templates'
  ];
begin
  foreach t in array member_read loop
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (organization_id = app.current_org_id())
    $f$, t || '_member_read', t);
  end loop;
end $$;

-- `organizations` se filtra por su propio id, no por organization_id.
create policy organizations_member_read on public.organizations
  for select to authenticated
  using (id = app.current_org_id());

-- Las plantillas de cartel del sistema no pertenecen a ninguna organización.
drop policy poster_templates_member_read on public.poster_templates;
create policy poster_templates_member_read on public.poster_templates
  for select to authenticated
  using (organization_id is null or organization_id = app.current_org_id());

-- -----------------------------------------------------------------------------
-- Tablas con costo, margen o deuda de proveedor: SOLO DUEÑO.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  owner_only text[] := array[
    'variant_costs','cost_history','inventory_lots','order_item_costs','price_history',
    'supplier_products','purchase_orders','purchase_order_items',
    'goods_receipts','goods_receipt_items','supplier_account_entries',
    'supplier_payments','supplier_returns','customer_account_entries',
    'report_snapshots','audit_logs','role_permissions',
    'employee_commissions','payroll_payments','courier_settlements',
    'employee_advances','employee_time_entries','product_suppliers'
  ];
begin
  foreach t in array owner_only loop
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (organization_id = app.current_org_id() and app.is_owner())
    $f$, t || '_owner_read', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Perfiles: cada quien se ve a sí mismo; el dueño ve a todo el equipo.
-- -----------------------------------------------------------------------------
create policy user_profiles_self_read on public.user_profiles
  for select to authenticated
  using (id = auth.uid() or (organization_id = app.current_org_id() and app.is_owner()));

create policy employee_profiles_read on public.employee_profiles
  for select to authenticated
  using (organization_id = app.current_org_id() and (app.is_owner() or user_id = auth.uid()));

-- -----------------------------------------------------------------------------
-- Notificaciones: las confidenciales son solo del dueño.
-- -----------------------------------------------------------------------------
create policy notifications_read on public.notifications
  for select to authenticated
  using (
    organization_id = app.current_org_id()
    and (user_id is null or user_id = auth.uid())
    and (not owner_only or app.is_owner())
  );

create policy notifications_update on public.notifications
  for update to authenticated
  using (
    organization_id = app.current_org_id()
    and (user_id is null or user_id = auth.uid())
    and (not owner_only or app.is_owner())
  )
  with check (organization_id = app.current_org_id());

-- -----------------------------------------------------------------------------
-- Escrituras directas permitidas: solo datos maestros sin efecto contable.
-- Todo lo demás pasa obligatoriamente por las funciones transaccionales.
-- -----------------------------------------------------------------------------

-- Catálogo: administrarlo es facultad del dueño (o de quien tenga el permiso).
do $$
declare
  t text;
  catalog_tables text[] := array[
    'categories','products','product_variants','product_images',
    'bundle_components','price_lists'
  ];
begin
  foreach t in array catalog_tables loop
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (organization_id = app.current_org_id() and app.has_permission('catalog.manage'))
    $f$, t || '_write_insert', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (organization_id = app.current_org_id() and app.has_permission('catalog.manage'))
        with check (organization_id = app.current_org_id())
    $f$, t || '_write_update', t);
    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (organization_id = app.current_org_id() and app.has_permission('catalog.manage'))
    $f$, t || '_write_delete', t);
  end loop;
end $$;

-- Clientes: el empleado puede darlos de alta y editarlos (5.2).
create policy customers_insert on public.customers
  for insert to authenticated
  with check (organization_id = app.current_org_id() and app.has_permission('customers.manage'));
create policy customers_update on public.customers
  for update to authenticated
  using (organization_id = app.current_org_id() and app.has_permission('customers.manage'))
  with check (organization_id = app.current_org_id());

-- Registro de ventas perdidas y consultas sin venta: pensado para tardar segundos.
create policy lost_sales_insert on public.lost_sales
  for insert to authenticated
  with check (organization_id = app.current_org_id() and app.is_member());

create policy employee_tasks_insert on public.employee_tasks
  for insert to authenticated
  with check (organization_id = app.current_org_id() and app.is_member());
create policy employee_tasks_update on public.employee_tasks
  for update to authenticated
  using (organization_id = app.current_org_id() and (app.is_owner() or assigned_to = auth.uid()))
  with check (organization_id = app.current_org_id());

-- Configuración y marca: solo el dueño.
create policy business_settings_update on public.business_settings
  for update to authenticated
  using (organization_id = app.current_org_id() and app.is_owner())
  with check (organization_id = app.current_org_id());
create policy brand_settings_update on public.brand_settings
  for update to authenticated
  using (organization_id = app.current_org_id() and app.is_owner())
  with check (organization_id = app.current_org_id());

do $$
declare
  t text;
  owner_managed text[] := array[
    'payment_methods','sales_channels','stock_locations','branches',
    'expense_categories','delivery_zones','suppliers','posters'
  ];
begin
  foreach t in array owner_managed loop
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (organization_id = app.current_org_id() and app.is_owner())
    $f$, t || '_owner_insert', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (organization_id = app.current_org_id() and app.is_owner())
        with check (organization_id = app.current_org_id())
    $f$, t || '_owner_update', t);
  end loop;
end $$;

-- `posters` los crea cualquier miembro habilitado a hacer cartelería.
drop policy posters_owner_insert on public.posters;
create policy posters_insert on public.posters
  for insert to authenticated
  with check (organization_id = app.current_org_id() and app.has_permission('posters.manage'));

-- -----------------------------------------------------------------------------
-- Verificación: ninguna tabla de `public` puede quedar sin RLS.
-- -----------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  select string_agg(c.relname, ', ')
    into v_missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_missing is not null then
    raise exception 'Tablas sin RLS: %', v_missing;
  end if;
end $$;
