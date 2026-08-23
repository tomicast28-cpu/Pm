import type { Metadata } from 'next';
import { requirePermission } from '@/server/session';
import { createClient } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/permissions';
import { PosScreen } from './pos-screen';
import type { PaymentMethod, PosCatalogItem, StockLocation } from '@/lib/types';
import type { PriceListRule as PriceList } from '@/lib/pricing';

export const metadata: Metadata = { title: 'Nueva venta' };

export default async function SalePage() {
  const session = await requirePermission(PERMISSIONS.salesCreate);
  const supabase = await createClient();

  const [
    { data: catalog },
    { data: paymentMethods },
    { data: priceLists },
    { data: locations },
    { data: customers },
    { data: channels },
    { data: openSession },
    { data: variantPrices },
  ] = await Promise.all([
    supabase
      .from('v_pos_catalog')
      .select('*')
      .eq('is_active', true)
      .eq('visible_in_pos', true)
      .order('product_name'),
    supabase.from('payment_methods').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('price_lists').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('stock_locations').select('*').eq('is_active', true).order('sort_order'),
    supabase
      .from('customers')
      .select('id, name, customer_type, is_walk_in, price_list_id, credit_enabled')
      .eq('is_active', true)
      .order('is_walk_in', { ascending: false })
      .order('name')
      .limit(300),
    supabase.from('sales_channels').select('*').eq('is_active', true).eq('is_external', false),
    supabase.from('v_cash_session_summary').select('*').eq('status', 'open').maybeSingle(),
    supabase.from('variant_prices').select('variant_id, price_list_id, price, tax_rate'),
  ]);

  return (
    <PosScreen
      catalog={(catalog ?? []) as PosCatalogItem[]}
      paymentMethods={(paymentMethods ?? []) as PaymentMethod[]}
      priceLists={(priceLists ?? []) as PriceList[]}
      variantPrices={variantPrices ?? []}
      locations={(locations ?? []) as StockLocation[]}
      customers={customers ?? []}
      channels={channels ?? []}
      cashSessionOpen={Boolean(openSession)}
      isOwner={session.role === 'owner'}
    />
  );
}
