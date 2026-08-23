import type { Metadata } from 'next';
import { requireSession, sessionCan } from '@/server/session';
import { createClient } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/permissions';
import { StockScreen } from './stock-screen';

export const metadata: Metadata = { title: 'Stock' };

export default async function StockPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: rows }, { data: locations }, { data: movements }] = await Promise.all([
    supabase
      .from('v_stock_by_location')
      .select('*')
      .eq('state', 'available')
      .order('display_name'),
    supabase.from('stock_locations').select('*').eq('is_active', true).order('sort_order'),
    supabase
      .from('inventory_movements')
      .select('id, movement_type, reason, created_at, reference_type')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  // La antigüedad valorizada solo se consulta si quien mira es el dueño:
  // la RLS devolvería cero filas de todos modos, pero no hay que pedirla.
  let aging: { age_bucket: string; immobilized_value: string; remaining_quantity: string }[] = [];
  if (session.role === 'owner') {
    const { data } = await supabase
      .from('v_stock_aging')
      .select('age_bucket, immobilized_value, remaining_quantity');
    aging = data ?? [];
  }

  return (
    <StockScreen
      rows={rows ?? []}
      locations={locations ?? []}
      movements={movements ?? []}
      aging={aging}
      canTransfer={sessionCan(session, PERMISSIONS.stockTransfer)}
      canAdjust={sessionCan(session, PERMISSIONS.stockAdjust)}
      canOnlineExit={sessionCan(session, PERMISSIONS.stockOnlineExit)}
      isOwner={session.role === 'owner'}
    />
  );
}
