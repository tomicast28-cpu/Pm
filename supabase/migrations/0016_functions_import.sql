-- =============================================================================
-- 0016 — Importación de catálogo.
--
-- Aplica un lote completo o ninguno. Registra el trabajo en `import_jobs` y
-- cada fila en `import_job_rows`, de modo que se sepa qué creó la importación y
-- se pueda revertir el lote entero mientras no haya movimientos posteriores.
-- =============================================================================

create or replace function apply_catalog_import(
  p_rows jsonb,           -- filas ya validadas por la aplicación
  p_bundles jsonb default '[]'::jsonb,
  p_file_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org      uuid := app.current_org_id();
  v_branch   uuid := app.current_branch_id();
  v_job      uuid;
  v_salon    uuid;
  v_altillo  uuid;
  v_movement uuid;

  v_pl_lista  uuid;
  v_pl_transf uuid;
  v_pl_mayor  uuid;

  it          jsonb;
  v_name      text;
  v_sku       text;
  v_kind      app.product_kind;
  v_category  uuid;
  v_supplier  uuid;
  v_product   uuid;
  v_variant   uuid;
  v_created   int := 0;
  v_skipped   int := 0;
  v_components int := 0;
  v_bundle    uuid;
  v_component uuid;
begin
  perform app.require_permission('catalog.manage');
  perform app.require(jsonb_typeof(p_rows) = 'array', 'El lote de importación no es válido');

  select id into v_salon   from stock_locations where branch_id = v_branch and code = 'SALON';
  select id into v_altillo from stock_locations where branch_id = v_branch and code = 'ALTILLO';

  select id into v_pl_lista  from price_lists where organization_id = v_org and code = 'lista';
  select id into v_pl_transf from price_lists where organization_id = v_org and code = 'transferencia';
  select id into v_pl_mayor  from price_lists where organization_id = v_org and code = 'mayorista';
  perform app.require(v_pl_lista is not null, 'No existe la lista de precios «lista»');

  insert into import_jobs (organization_id, kind, file_name, status, total_rows, created_by)
  values (v_org, 'catalog', p_file_name, 'pending', jsonb_array_length(p_rows), auth.uid())
  returning id into v_job;

  -- El stock inicial entra como movimiento real, no como escritura de saldos.
  v_movement := app.record_movement(
    v_org, v_branch, 'initial_inventory', 'import', v_job,
    'Stock inicial de la importación ' || coalesce(p_file_name, v_job::text));

  -- ---------------------------------------------------------------------------
  -- Productos y variantes
  -- ---------------------------------------------------------------------------
  for it in select * from jsonb_array_elements(p_rows) loop
    v_name := it ->> 'nombre';
    v_sku  := nullif(it ->> 'sku', '');
    v_kind := (it ->> 'tipo')::app.product_kind;

    -- Un SKU ya existente no se pisa: se salta y se informa.
    if v_sku is not null and exists (
      select 1 from product_variants where organization_id = v_org and sku = v_sku
    ) then
      insert into import_job_rows (organization_id, job_id, row_number, raw_data, status, errors)
      values (v_org, v_job, coalesce((it ->> 'fila')::int, 0), it, 'skipped',
              array['El SKU ' || v_sku || ' ya existe: no se sobrescribió']);
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Categoría y proveedor se crean si no existían.
    v_category := null;
    if nullif(it ->> 'categoria', '') is not null then
      select id into v_category from categories
       where organization_id = v_org and name = it ->> 'categoria' and parent_id is null;
      if not found then
        insert into categories (organization_id, name)
        values (v_org, it ->> 'categoria')
        returning id into v_category;
      end if;
    end if;

    v_supplier := null;
    if nullif(it ->> 'proveedor', '') is not null then
      select id into v_supplier from suppliers
       where organization_id = v_org and name = it ->> 'proveedor';
      if not found then
        insert into suppliers (organization_id, name)
        values (v_org, it ->> 'proveedor')
        returning id into v_supplier;
      end if;
    end if;

    -- Las variantes de un mismo producto se agrupan por nombre.
    select p.id into v_product
      from products p
     where p.organization_id = v_org and p.name = v_name and p.kind = v_kind
     limit 1;

    if not found then
      insert into products (
        organization_id, category_id, kind, name, is_inventoried, is_active
      )
      values (
        v_org, v_category, v_kind, v_name, v_kind <> 'service',
        coalesce((it ->> 'activo')::boolean, true)
      )
      returning id into v_product;
    end if;

    if v_sku is null then
      v_sku := app.next_document_number(v_org, 'sku', null);
    end if;

    insert into product_variants (
      organization_id, product_id, sku, barcode, name, attributes,
      min_stock, preferred_location_id, is_active
    )
    values (
      v_org, v_product, v_sku, nullif(it ->> 'codigo_barras', ''),
      coalesce(nullif(it ->> 'variante', ''), ''),
      coalesce(it -> 'atributos', '{}'::jsonb),
      coalesce((it ->> 'stock_minimo')::numeric, 0),
      v_salon,
      coalesce((it ->> 'activo')::boolean, true)
    )
    returning id into v_variant;

    -- Precios: los que vengan vacíos quedan derivados de la lista base.
    if nullif(it ->> 'precio_lista', '') is not null then
      perform set_variant_price(v_variant, v_pl_lista, (it ->> 'precio_lista')::numeric,
                                'Importación de catálogo');
    end if;
    if nullif(it ->> 'precio_transferencia', '') is not null and v_pl_transf is not null then
      perform set_variant_price(v_variant, v_pl_transf, (it ->> 'precio_transferencia')::numeric,
                                'Importación de catálogo');
    end if;
    if nullif(it ->> 'precio_mayorista', '') is not null and v_pl_mayor is not null then
      perform set_variant_price(v_variant, v_pl_mayor, (it ->> 'precio_mayorista')::numeric,
                                'Importación de catálogo');
    end if;

    if nullif(it ->> 'costo', '') is not null then
      perform set_variant_cost(v_variant, (it ->> 'costo')::numeric,
                               'Importación de catálogo', 'import', v_supplier);
    end if;

    if v_supplier is not null then
      insert into product_suppliers (product_id, supplier_id, organization_id, is_primary)
      values (v_product, v_supplier, v_org, true)
      on conflict (product_id, supplier_id) do nothing;
    end if;

    -- Stock inicial por ubicación.
    if coalesce((it ->> 'stock_salon')::numeric, 0) > 0 and v_salon is not null then
      perform app.stock_in(v_movement, v_variant, v_salon,
                           (it ->> 'stock_salon')::numeric,
                           coalesce((it ->> 'costo')::numeric, 0),
                           'available', v_supplier);
    end if;
    if coalesce((it ->> 'stock_altillo')::numeric, 0) > 0 and v_altillo is not null then
      perform app.stock_in(v_movement, v_variant, v_altillo,
                           (it ->> 'stock_altillo')::numeric,
                           coalesce((it ->> 'costo')::numeric, 0),
                           'available', v_supplier);
    end if;

    insert into import_job_rows (
      organization_id, job_id, row_number, raw_data, status, created_entity, created_id
    )
    values (v_org, v_job, coalesce((it ->> 'fila')::int, 0), it, 'applied',
            'product_variant', v_variant);
    v_created := v_created + 1;
  end loop;

  -- ---------------------------------------------------------------------------
  -- Componentes de combos (se resuelven después, cuando ya existen los SKU)
  -- ---------------------------------------------------------------------------
  for it in select * from jsonb_array_elements(coalesce(p_bundles, '[]'::jsonb)) loop
    select id into v_bundle from product_variants
     where organization_id = v_org and sku = it ->> 'sku_combo';
    select id into v_component from product_variants
     where organization_id = v_org and sku = it ->> 'sku_componente';

    if v_bundle is null or v_component is null then
      insert into import_job_rows (organization_id, job_id, row_number, raw_data, status, errors)
      values (v_org, v_job, coalesce((it ->> 'fila')::int, 0), it, 'error',
              array['No se encontró el combo o el componente indicado']);
      continue;
    end if;

    insert into bundle_components (
      organization_id, bundle_variant_id, component_variant_id, quantity
    )
    values (v_org, v_bundle, v_component, (it ->> 'cantidad')::numeric)
    on conflict (bundle_variant_id, component_variant_id)
    do update set quantity = excluded.quantity;

    v_components := v_components + 1;
  end loop;

  update import_jobs
     set status = 'applied',
         valid_rows = v_created,
         applied_rows = v_created,
         error_rows = v_skipped,
         applied_at = now(),
         summary = jsonb_build_object('creadas', v_created, 'omitidas', v_skipped,
                                      'componentes', v_components)
   where id = v_job;

  perform app.audit('apply_catalog_import', 'import_job', v_job::text, null,
                    jsonb_build_object('file', p_file_name, 'creadas', v_created,
                                       'omitidas', v_skipped, 'componentes', v_components),
                    null);

  return jsonb_build_object(
    'job_id', v_job,
    'creadas', v_created,
    'omitidas', v_skipped,
    'componentes', v_components
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Reversión del lote: solo si nada de lo creado tuvo movimientos posteriores.
-- -----------------------------------------------------------------------------
create or replace function revert_catalog_import(p_job uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     uuid := app.current_org_id();
  v_job     import_jobs;
  v_blocked int;
  v_deleted int := 0;
begin
  perform app.require_owner();
  perform app.require(coalesce(btrim(p_reason), '') <> '',
                      'Revertir una importación requiere un motivo');

  select * into v_job from import_jobs where id = p_job and organization_id = v_org for update;
  perform app.require(found, 'Importación inexistente');
  perform app.require(v_job.status = 'applied', 'Esa importación no está aplicada');

  -- Si alguna variante creada ya se movió por fuera de la propia importación,
  -- revertir borraría historia real. En ese caso no se revierte.
  select count(*) into v_blocked
    from import_job_rows r
    join inventory_movement_items mi on mi.variant_id = r.created_id
    join inventory_movements m on m.id = mi.movement_id
   where r.job_id = p_job
     and r.created_entity = 'product_variant'
     and m.movement_type <> 'initial_inventory';

  if v_blocked > 0 then
    raise exception 'No se puede revertir: % productos de esa importación ya tuvieron movimientos posteriores', v_blocked
      using errcode = 'check_violation';
  end if;

  -- El libro de movimientos tiene `on delete restrict` sobre las variantes,
  -- justamente para que la historia no se pueda borrar. Acá ya se comprobó que
  -- el único movimiento de estas variantes es el inventario inicial que creó la
  -- propia importación, así que se elimina ese movimiento (y en cascada sus
  -- ítems) antes de las variantes.
  delete from inventory_movements
   where organization_id = v_org
     and reference_type = 'import'
     and reference_id = p_job;

  -- Borrar las variantes creadas arrastra en cascada precios, costos y lotes.
  delete from product_variants
   where id in (
     select created_id from import_job_rows
      where job_id = p_job and created_entity = 'product_variant' and created_id is not null
   );
  get diagnostics v_deleted = row_count;

  -- Productos que quedaron sin ninguna variante.
  delete from products p
   where p.organization_id = v_org
     and not exists (select 1 from product_variants v where v.product_id = p.id);

  update import_jobs
     set status = 'reverted', reverted_at = now()
   where id = p_job;

  perform app.audit('revert_catalog_import', 'import_job', p_job::text,
                    to_jsonb(v_job), jsonb_build_object('eliminadas', v_deleted), p_reason);

  return jsonb_build_object('job_id', p_job, 'eliminadas', v_deleted);
end;
$$;
