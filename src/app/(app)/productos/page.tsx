import type { Metadata } from 'next';
import { requireSession } from '@/server/session';
import { createClient } from '@/lib/supabase/server';
import { Badge, Card, EmptyState } from '@/components/ui';
import { formatMoney, formatQuantity, formatPercent } from '@/lib/format';
import { Money } from '@/lib/money';
import { resolvePrice, type PriceListRule } from '@/lib/pricing';

export const metadata: Metadata = { title: 'Productos' };

const KIND_LABELS: Record<string, string> = {
  simple: 'Simple',
  variant: 'Con variantes',
  service: 'Servicio',
  bundle_virtual: 'Combo virtual',
  bundle_stocked: 'Combo prearmado',
};

export default async function ProductsPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const isOwner = session.role === 'owner';

  const [{ data: catalog }, { data: priceLists }, { data: variantPrices }] = await Promise.all([
    supabase.from('v_pos_catalog').select('*').order('product_name'),
    supabase.from('price_lists').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('variant_prices').select('variant_id, price_list_id, price, tax_rate'),
  ]);

  // Los costos solo se piden si quien mira es el dueño. La RLS ya lo garantiza,
  // pero pedir lo que no corresponde sería pedir de más.
  let costs: Record<string, { last_cost: string; average_cost: string }> = {};
  if (isOwner) {
    const { data } = await supabase
      .from('variant_costs')
      .select('variant_id, last_cost, average_cost');
    costs = Object.fromEntries((data ?? []).map((c) => [c.variant_id, c]));
  }

  const lists = (priceLists ?? []) as PriceListRule[];
  const defaultList = lists.find((l) => l.is_default) ?? lists[0];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-madera-900">Productos</h1>
        <p className="text-sm text-madera-500">
          {catalog?.length ?? 0} variantes en el catálogo
          {isOwner && ' · el margen se calcula con el último costo de reposición'}
        </p>
      </header>

      <Card>
        {!catalog || catalog.length === 0 ? (
          <EmptyState
            title="Todavía no hay productos"
            description="Importá el catálogo desde la plantilla XLSX o cargalos uno por uno."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-madera-200 text-left text-xs text-madera-500">
                  <th className="px-4 py-2 font-medium">Producto</th>
                  <th className="px-2 py-2 font-medium">Tipo</th>
                  <th className="px-2 py-2 font-medium">Categoría</th>
                  <th className="px-2 py-2 text-right font-medium">Precio</th>
                  {isOwner && <th className="px-2 py-2 text-right font-medium">Costo</th>}
                  {isOwner && <th className="px-2 py-2 text-right font-medium">Margen</th>}
                  <th className="px-4 py-2 text-right font-medium">Disponible</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((item) => {
                  const price = defaultList
                    ? resolvePrice(item.variant_id, defaultList.id, lists, variantPrices ?? [])
                    : null;
                  const cost = costs[item.variant_id];
                  const lastCost = cost ? Money.parse(cost.last_cost) : null;
                  const margin =
                    price && lastCost && !price.isZero()
                      ? (price.toNumber() - lastCost.toNumber()) / price.toNumber()
                      : null;

                  return (
                    <tr key={item.variant_id} className="border-b border-madera-100">
                      <td className="px-4 py-2">
                        <p className="text-madera-900">{item.display_name}</p>
                        <p className="text-xs text-madera-500">{item.sku}</p>
                      </td>
                      <td className="px-2 py-2 text-xs text-madera-600">
                        {KIND_LABELS[item.kind] ?? item.kind}
                      </td>
                      <td className="px-2 py-2 text-xs text-madera-600">
                        {item.category_name ?? '—'}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {price ? formatMoney(price) : '—'}
                      </td>
                      {isOwner && (
                        <td className="tabular px-2 py-2 text-right text-madera-600">
                          {lastCost ? formatMoney(lastCost) : '—'}
                        </td>
                      )}
                      {isOwner && (
                        <td className="tabular px-2 py-2 text-right">
                          {margin === null ? (
                            '—'
                          ) : (
                            <span className={margin < 0.2 ? 'text-fuego-600' : 'text-emerald-700'}>
                              {formatPercent(margin)}
                            </span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-2 text-right">
                        {!item.is_inventoried ? (
                          <Badge tone="info">Servicio</Badge>
                        ) : Number(item.available_qty) <= 0 ? (
                          <Badge tone="bad">Sin stock</Badge>
                        ) : (
                          <span className="tabular">{formatQuantity(item.available_qty)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
