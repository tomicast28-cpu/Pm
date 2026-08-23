import type { Metadata } from 'next';
import { requireSession } from '@/server/session';
import { createClient } from '@/lib/supabase/server';
import { CashScreen } from './cash-screen';

export const metadata: Metadata = { title: 'Caja' };

export default async function CashPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: registers }, { data: openSession }, { data: recentSessions }] = await Promise.all([
    supabase.from('cash_registers').select('id, name').eq('is_active', true).order('name'),
    supabase.from('cash_sessions').select('*').eq('status', 'open').maybeSingle(),
    supabase
      .from('cash_sessions')
      .select('id, number, status, opened_at, closed_at, opening_amount, expected_cash, declared_cash, cash_difference, reopened_count')
      .order('opened_at', { ascending: false })
      .limit(10),
  ]);

  // El detalle esperado por medio de pago se calcula en la base, no en la UI.
  let expected: {
    payment_method_id: string;
    label: string;
    affects_drawer: boolean;
    expected_amount: string;
  }[] = [];
  let movements: {
    id: string;
    movement_type: string;
    amount: string;
    description: string | null;
    created_at: string;
    affects_drawer: boolean;
  }[] = [];

  if (openSession) {
    const [{ data: expectedRows }, { data: movementRows }] = await Promise.all([
      supabase.rpc('cash_session_expected_public', { p_session: openSession.id }),
      supabase
        .from('cash_movements')
        .select('id, movement_type, amount, description, created_at, affects_drawer')
        .eq('session_id', openSession.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    expected = (expectedRows ?? []) as typeof expected;
    movements = (movementRows ?? []) as typeof movements;
  }

  return (
    <CashScreen
      registers={registers ?? []}
      openSession={openSession}
      expected={expected}
      movements={movements}
      recentSessions={recentSessions ?? []}
      isOwner={session.role === 'owner'}
    />
  );
}
