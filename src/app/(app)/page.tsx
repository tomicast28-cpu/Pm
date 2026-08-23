import Link from 'next/link';
import { requireSession } from '@/server/session';
import { createClient } from '@/lib/supabase/server';
import { Card, Stat, Badge, EmptyState, Button } from '@/components/ui';
import { formatMoney, formatQuantity, formatDateTime } from '@/lib/format';
import { Money } from '@/lib/money';

export default async function HomePage() {
  const session = await requireSession();
  const supabase = await createClient();
  const isOwner = session.role === 'owner';

  const today = new Date();
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);

  const [
    { data: todaySales },
    { data: openSession },
    { data: lowStock },
    { data: pendingOrders },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('id, total, discount_total')
      .eq('kind', 'sale')
      .neq('status', 'cancelled')
      .gte('created_at', startOfDay.toISOString()),
    supabase
      .from('v_cash_session_summary')
      .select('*')
      .eq('status', 'open')
      .maybeSingle(),
    supabase
      .from('v_stock_by_location')
      .select('variant_id, sku, display_name, location_name, available, min_stock')
      .eq('below_minimum', true)
      .limit(8),
    supabase
      .from('orders')
      .select('id, number, status, total, balance_due, created_at')
      .in('status', ['reserved', 'deposit_received', 'pending_manufacturing', 'ready_for_pickup'])
      .limit(8),
  ]);

  const salesCount = todaySales?.length ?? 0;
  const salesTotal = Money.sum((todaySales ?? []).map((o) => Money.parse(o.total)));
  const averageTicket = salesCount > 0 ? Money.fromCents(salesTotal.cents / BigInt(salesCount)) : Money.zero;

  // El margen solo se calcula (y se consulta) si quien mira es el dueño.
  let marginToday: Money | null = null;
  if (isOwner) {
    const { data: margins } = await supabase
      .from('v_sale_margins')
      .select('direct_contribution')
      .gte('created_at', startOfDay.toISOString())
      .neq('status', 'cancelled');
    marginToday = Money.sum((margins ?? []).map((m) => Money.parse(m.direct_contribution)));
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-madera-900">
            Hola, {session.fullName.split(' ')[0]}
          </h1>
          <p className="text-sm text-madera-500">
            {isOwner ? 'Resumen del negocio' : 'Tu día en el local'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/venta">
            <Button size="lg">Nueva venta</Button>
          </Link>
          {!openSession && (
            <Link href="/caja">
              <Button size="lg" variant="secondary">
                Abrir caja
              </Button>
            </Link>
          )}
        </div>
      </header>

      {/* Aviso operativo: sin caja abierta no se puede cobrar. */}
      {!openSession && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">La caja está cerrada</p>
          <p className="text-sm text-amber-800">
            Abrí la caja declarando el efectivo inicial para poder registrar cobros.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Venta de hoy" value={formatMoney(salesTotal)} hint={`${salesCount} ventas`} />
        <Stat label="Ticket promedio" value={formatMoney(averageTicket)} />
        {isOwner ? (
          <Stat
            label="Margen estimado de hoy"
            value={formatMoney(marginToday ?? Money.zero)}
            hint="Contribución directa"
            tone={marginToday && marginToday.isNegative() ? 'bad' : 'good'}
          />
        ) : (
          <Stat
            label="Ventas registradas"
            value={formatQuantity(salesCount)}
            hint="En tu turno de hoy"
          />
        )}
        <Stat
          label="Efectivo esperado en caja"
          value={openSession ? formatMoney(openSession.drawer_balance) : '—'}
          hint={openSession ? `Caja ${openSession.number}` : 'Caja cerrada'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Stock bajo"
          action={
            <Link href="/stock" className="text-xs text-madera-600 underline">
              Ver stock
            </Link>
          }
        >
          {lowStock && lowStock.length > 0 ? (
            <ul className="divide-y divide-madera-100">
              {lowStock.map((row) => (
                <li
                  key={`${row.variant_id}-${row.location_name}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-madera-800">{row.display_name}</p>
                    <p className="text-xs text-madera-500">
                      {row.sku} · {row.location_name}
                    </p>
                  </div>
                  <Badge tone="warn">
                    {formatQuantity(row.available)} / mín {formatQuantity(row.min_stock)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="Sin faltantes"
              description="Ningún producto está por debajo de su stock mínimo."
            />
          )}
        </Card>

        <Card
          title="Pedidos pendientes"
          action={
            <Link href="/pedidos" className="text-xs text-madera-600 underline">
              Ver pedidos
            </Link>
          }
        >
          {pendingOrders && pendingOrders.length > 0 ? (
            <ul className="divide-y divide-madera-100">
              {pendingOrders.map((order) => (
                <li key={order.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-madera-800">{order.number}</p>
                    <p className="text-xs text-madera-500">{formatDateTime(order.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-sm text-madera-800">{formatMoney(order.total)}</p>
                    {Money.parse(order.balance_due).isZero() ? (
                      <Badge tone="good">Saldado</Badge>
                    ) : (
                      <Badge tone="warn">Debe {formatMoney(order.balance_due)}</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="Sin pedidos pendientes"
              description="Los presupuestos, señas y encargos aparecen acá."
            />
          )}
        </Card>
      </div>
    </div>
  );
}
