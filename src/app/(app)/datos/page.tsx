import type { Metadata } from 'next';
import { requireOwner } from '@/server/session';
import { createClient } from '@/lib/supabase/server';
import { DataScreen } from './data-screen';

export const metadata: Metadata = { title: 'Importar y exportar' };

export default async function DataPage() {
  await requireOwner();
  const supabase = await createClient();

  const { data: jobs } = await supabase
    .from('import_jobs')
    .select('id, kind, file_name, status, total_rows, applied_rows, error_rows, created_at, summary')
    .order('created_at', { ascending: false })
    .limit(20);

  return <DataScreen jobs={jobs ?? []} />;
}
