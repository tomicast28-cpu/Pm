import type { Metadata } from 'next';
import { requireOwner } from '@/server/session';
import { createClient } from '@/lib/supabase/server';
import { Card, EmptyState, Badge } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Auditoría' };

const ACTION_LABELS: Record<string, string> = {
  create_instant_sale: 'Venta registrada',
  add_order_payment: 'Cobro registrado',
  reverse_sale: 'Venta revertida',
  open_cash_session: 'Caja abierta',
  close_cash_session: 'Caja cerrada',
  reopen_cash_session: 'Caja reabierta',
  record_cash_movement: 'Movimiento de caja',
  transfer_stock: 'Transferencia de stock',
  adjust_stock: 'Ajuste de stock',
  assemble_bundle: 'Combo armado',
  disassemble_bundle: 'Combo desarmado',
  online_sale_exit: 'Salida por venta online',
  set_variant_price: 'Cambio de precio',
  set_variant_cost: 'Cambio de costo',
};

const SENSITIVE_ACTIONS = new Set([
  'reverse_sale',
  'reopen_cash_session',
  'adjust_stock',
  'set_variant_cost',
]);

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ accion?: string }>;
}) {
  await requireOwner();
  const { accion } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('audit_logs')
    .select('id, action, entity, entity_id, reason, created_at, user_role, after_data, user_id')
    .order('created_at', { ascending: false })
    .limit(200);

  if (accion) query = query.eq('action', accion);

  const [{ data: logs }, { data: profiles }] = await Promise.all([
    query,
    supabase.from('user_profiles').select('id, full_name'),
  ]);

  const names = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-madera-900">Auditoría</h1>
        <p className="text-sm text-madera-500">
          Toda acción sensible queda registrada con usuario, fecha y motivo. No se puede borrar.
        </p>
      </header>

      <Card>
        {!logs || logs.length === 0 ? (
          <EmptyState title="Sin registros todavía" />
        ) : (
          <ul className="divide-y divide-madera-100">
            {logs.map((log) => (
              <li key={log.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-madera-900">
                    {ACTION_LABELS[log.action] ?? log.action}
                    {SENSITIVE_ACTIONS.has(log.action) && (
                      <span className="ml-2">
                        <Badge tone="warn">Sensible</Badge>
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-madera-500">
                    {names[log.user_id] ?? 'Sistema'}
                    {log.user_role && ` (${log.user_role === 'owner' ? 'dueño' : 'empleado'})`}
                    {' · '}
                    {log.entity}
                  </p>
                  {log.reason && (
                    <p className="mt-0.5 text-xs italic text-madera-600">Motivo: {log.reason}</p>
                  )}
                </div>
                <time className="shrink-0 text-xs text-madera-500">
                  {formatDateTime(log.created_at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
