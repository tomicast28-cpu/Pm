import type { Metadata } from 'next';
import { requireOwner } from '@/server/session';
import { createClient } from '@/lib/supabase/server';
import { NewProductForm } from './new-product-form';

export const metadata: Metadata = { title: 'Nuevo producto' };

export default async function NewProductPage() {
  await requireOwner();
  const supabase = await createClient();

  const [{ data: categories }, { data: locations }, { data: catalog }] = await Promise.all([
    supabase.from('categories').select('id, name').eq('is_active', true).order('name'),
    supabase.from('stock_locations').select('id, name, is_default').eq('is_active', true).order('sort_order'),
    supabase
      .from('v_pos_catalog')
      .select('variant_id, sku, display_name, kind')
      .eq('is_active', true)
      .order('product_name'),
  ]);

  return (
    <NewProductForm
      categories={categories ?? []}
      locations={locations ?? []}
      // Un combo solo puede componerse de piezas que no sean combos.
      components={(catalog ?? []).filter(
        (c) => c.kind !== 'bundle_virtual' && c.kind !== 'bundle_stocked',
      )}
    />
  );
}
