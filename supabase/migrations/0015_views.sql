-- =============================================================================
-- 0015 — Vistas de consulta.
--
-- Todas se crean con `security_invoker = true`: se evalúan con los permisos de
-- quien consulta, de modo que la RLS de las tablas de base sigue aplicando.
-- Sin esto, una vista sería un agujero por el que el empleado leería costos.
-- =============================================================================

-- Catálogo para el punto de venta. NO expone costos: la puede leer el empleado.
create view v_pos_catalog with (security_invoker = true) as
select
  v.id                        as variant_id,
  v.organization_id,
  v.sku,
  v.barcode,
  p.id                        as product_id,
  p.name                      as product_name,
  v.name                      as variant_name,
  p.name || case when coalesce(v.name, '') <> '' then ' — ' || v.name else '' end as display_name,
  app.normalize_text(p.name || ' ' || coalesce(v.name, '') || ' ' || v.sku) as search_text,
  p.kind,
  p.category_id,
  c.name                      as category_name,
  p.brand,
  p.tags,
  p.is_inventoried,
  p.visible_in_pos,
  v.attributes,
  v.unit,
  v.min_stock,
  v.allows_backorder,
  v.is_active,
  app.available_qty_effective(v.id) as available_qty,
  (select coalesce(sum(b.on_hand), 0) from inventory_balances b
    where b.variant_id = v.id and b.state = 'available') as on_hand_qty,
  (select coalesce(sum(b.reserved), 0) from inventory_balances b
    where b.variant_id = v.id and b.state = 'available') as reserved_qty,
  (select pi.storage_path from product_images pi
    where pi.product_id = p.id order by pi.is_primary desc, pi.sort_order limit 1) as image_path
from product_variants v
join products p on p.id = v.product_id
left join categories c on c.id = p.category_id;

grant select on v_pos_catalog to authenticated;

-- Stock por variante y ubicación, con antigüedad de la unidad más vieja.
create view v_stock_by_location with (security_invoker = true) as
select
  b.organization_id,
  b.branch_id,
  b.variant_id,
  v.sku,
  p.name || case when coalesce(v.name, '') <> '' then ' — ' || v.name else '' end as display_name,
  b.location_id,
  l.name  as location_name,
  b.state,
  b.on_hand,
  b.reserved,
  (b.on_hand - b.reserved) as available,
  v.min_stock,
  (b.on_hand - b.reserved) < v.min_stock as below_minimum,
  b.updated_at
from inventory_balances b
join product_variants v on v.id = b.variant_id
join products p on p.id = v.product_id
join stock_locations l on l.id = b.location_id;

grant select on v_stock_by_location to authenticated;

-- Antigüedad de stock por lote. Contiene costo => solo el dueño la ve.
create view v_stock_aging with (security_invoker = true) as
select
  lot.organization_id,
  lot.variant_id,
  v.sku,
  p.name || case when coalesce(v.name, '') <> '' then ' — ' || v.name else '' end as display_name,
  lot.location_id,
  l.name as location_name,
  lot.id as lot_id,
  lot.received_at,
  lot.remaining_quantity,
  lot.unit_cost,
  round(lot.remaining_quantity * lot.unit_cost, 2) as immobilized_value,
  (current_date - lot.received_at::date) as age_days,
  case
    when (current_date - lot.received_at::date) < 30  then '0-29'
    when (current_date - lot.received_at::date) < 60  then '30-59'
    when (current_date - lot.received_at::date) < 90  then '60-89'
    when (current_date - lot.received_at::date) < 180 then '90-179'
    else '180+'
  end as age_bucket,
  (select max(m.created_at)
     from inventory_movement_items mi
     join inventory_movements m on m.id = mi.movement_id
    where mi.variant_id = lot.variant_id and m.movement_type = 'sale') as last_sold_at
from inventory_lots lot
join product_variants v on v.id = lot.variant_id
join products p on p.id = v.product_id
join stock_locations l on l.id = lot.location_id
where lot.remaining_quantity > 0;

grant select on v_stock_aging to authenticated;

-- Rentabilidad por línea vendida. Une con `order_item_costs` => solo dueño.
create view v_sale_margins with (security_invoker = true) as
select
  o.organization_id,
  o.branch_id,
  o.id            as order_id,
  o.number,
  o.created_at,
  o.status,
  oi.id           as order_item_id,
  oi.variant_id,
  oi.sku_snapshot,
  oi.name_snapshot,
  oi.quantity,
  oi.line_total   as net_revenue,
  oic.last_cost   as replacement_cost,
  oic.average_cost,
  oic.fifo_cost,
  oic.extra_direct_cost,
  -- Comisión de cobro imputada a la línea, a prorrata de su peso en la venta.
  round(
    coalesce((select sum(pm.commission_amount) from payments pm
               where pm.order_id = o.id and pm.status = 'confirmed'), 0)
    * case when o.total > 0 then oi.line_total / o.total else 0 end, 2
  ) as allocated_commission,
  round(
    oi.line_total
    - oic.last_cost
    - oic.extra_direct_cost
    - coalesce((select sum(pm.commission_amount) from payments pm
                 where pm.order_id = o.id and pm.status = 'confirmed'), 0)
      * case when o.total > 0 then oi.line_total / o.total else 0 end
  , 2) as direct_contribution
from orders o
join order_items oi on oi.order_id = o.id
join order_item_costs oic on oic.order_item_id = oi.id
where o.kind = 'sale';

grant select on v_sale_margins to authenticated;

-- Resumen de caja abierta: lo que el empleado necesita ver sin costos.
create view v_cash_session_summary with (security_invoker = true) as
select
  s.id as session_id,
  s.organization_id,
  s.branch_id,
  s.number,
  s.status,
  s.opening_amount,
  s.opened_at,
  s.closed_at,
  coalesce((select sum(cm.amount) from cash_movements cm
             where cm.session_id = s.id and cm.affects_drawer), 0) as drawer_balance,
  coalesce((select sum(p.amount - p.change_given) from payments p
             where p.cash_session_id = s.id and p.status = 'confirmed' and p.direction = 'in'), 0)
    as collected_total,
  (select count(*) from orders o where o.cash_session_id = s.id and o.status <> 'cancelled')
    as sales_count
from cash_sessions s;

grant select on v_cash_session_summary to authenticated;

-- Ventas del día, sin datos confidenciales.
-- Las unidades se agregan por pedido ANTES de sumar, para no multiplicar los
-- totales por la cantidad de líneas.
create view v_sales_daily with (security_invoker = true) as
with per_order as (
  select
    o.organization_id,
    o.branch_id,
    (o.created_at at time zone 'America/Argentina/Buenos_Aires')::date as sale_date,
    o.id,
    o.total,
    o.discount_total,
    (select coalesce(sum(oi.quantity), 0) from order_items oi where oi.order_id = o.id) as units
  from orders o
  where o.kind = 'sale' and o.status <> 'cancelled'
)
select
  organization_id,
  branch_id,
  sale_date,
  count(*)                                     as sales_count,
  sum(total)                                   as net_sales,
  sum(discount_total)                          as discounts,
  round(sum(total) / nullif(count(*), 0), 2)   as average_ticket,
  sum(units)                                   as units
from per_order
group by organization_id, branch_id, sale_date;

grant select on v_sales_daily to authenticated;
