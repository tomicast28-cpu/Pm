import type { Metadata } from 'next';
import { requireOwner } from '@/server/session';
import { createClient } from '@/lib/supabase/server';
import { Card, Badge } from '@/components/ui';
import { formatMoney, formatPercent } from '@/lib/format';

export const metadata: Metadata = { title: 'Configuración' };

export default async function SettingsPage() {
  await requireOwner();
  const supabase = await createClient();

  const [{ data: settings }, { data: methods }, { data: lists }, { data: locations }] =
    await Promise.all([
      supabase.from('business_settings').select('*').maybeSingle(),
      supabase.from('payment_methods').select('*').order('sort_order'),
      supabase.from('price_lists').select('*').order('sort_order'),
      supabase.from('stock_locations').select('*').order('sort_order'),
    ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-madera-900">Configuración</h1>
        <p className="text-sm text-madera-500">
          Estos valores son configuración, no constantes del código. La edición desde la interfaz
          llega con la fase 5; hoy se cambian en la base.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Reglas comerciales">
          <dl className="divide-y divide-madera-100">
            <Row label="Precios con IVA incluido" value={settings?.prices_include_tax ? 'Sí' : 'No'} />
            <Row label="IVA predeterminado" value={formatPercent(settings?.default_tax_rate)} />
            <Row
              label="Descuento por transferencia"
              value={formatPercent(settings?.transfer_discount_rate)}
            />
            <Row
              label="Venta sin stock"
              value={settings?.allow_negative_stock ? 'Permitida' : 'Bloqueada'}
            />
            <Row label="Vigencia de reserva" value={`${settings?.reservation_hours ?? 48} horas`} />
            <Row
              label="Vigencia de presupuesto"
              value={`${settings?.quote_validity_days ?? 7} días`}
            />
            <Row
              label="Alertas de antigüedad"
              value={`${(settings?.aging_buckets_days ?? []).join(' / ')} días`}
            />
            <Row label="Margen mínimo" value={formatPercent(settings?.min_margin_rate)} />
            <Row
              label="Conteo de visitas"
              value={settings?.visitor_counter_enabled ? 'Activado' : 'Desactivado'}
            />
          </dl>
        </Card>

        <Card title="Medios de pago">
          <ul className="divide-y divide-madera-100">
            {(methods ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <div>
                  <p className="text-sm text-madera-900">{m.name}</p>
                  <p className="text-xs text-madera-500">
                    {m.affects_cash_drawer ? 'Afecta el cajón' : 'No toca el cajón'}
                    {Number(m.commission_rate) > 0 &&
                      ` · comisión ${formatPercent(m.commission_rate, 2)}`}
                    {Number(m.commission_fixed) > 0 && ` + ${formatMoney(m.commission_fixed)}`}
                    {m.settlement_days > 0 && ` · acredita en ${m.settlement_days} días`}
                  </p>
                </div>
                {m.requires_confirmation && <Badge tone="warn">A confirmar</Badge>}
                {m.is_account_credit && <Badge tone="info">Cuenta corriente</Badge>}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Listas de precio">
          <ul className="divide-y divide-madera-100">
            {(lists ?? []).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <div>
                  <p className="text-sm text-madera-900">{l.name}</p>
                  <p className="text-xs text-madera-500">
                    {l.derived_from_id
                      ? `Derivada · ${formatPercent(l.adjustment_rate)} · redondeo ${l.rounding}`
                      : 'Precios propios'}
                  </p>
                </div>
                {l.is_default && <Badge tone="good">Predeterminada</Badge>}
                {l.is_wholesale && <Badge tone="info">Mayorista</Badge>}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Ubicaciones de stock">
          <ul className="divide-y divide-madera-100">
            {(locations ?? []).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <div>
                  <p className="text-sm text-madera-900">{l.name}</p>
                  <p className="text-xs text-madera-500">
                    {l.sellable ? 'Cuenta como disponible' : 'No disponible para venta'}
                  </p>
                </div>
                {l.is_default && <Badge tone="good">Predeterminada</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <dt className="text-sm text-madera-600">{label}</dt>
      <dd className="text-sm font-medium text-madera-900">{value}</dd>
    </div>
  );
}
