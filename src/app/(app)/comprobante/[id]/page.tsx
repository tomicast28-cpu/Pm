import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { createClient } from '@/lib/supabase/server';
import { formatMoney, formatDateTime, formatQuantity } from '@/lib/format';
import { Money } from '@/lib/money';
import { PrintButton } from './print-button';

export const metadata: Metadata = { title: 'Comprobante' };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession();
  const supabase = await createClient();

  const [{ data: order }, { data: items }, { data: payments }, { data: settings }, { data: brand }] =
    await Promise.all([
      supabase
        .from('orders')
        .select('*, customers(name, document_type, document_number, address)')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('order_items').select('*').eq('order_id', id).order('line_number'),
      supabase
        .from('payments')
        .select('amount, change_given, status, direction, payment_methods(name)')
        .eq('order_id', id)
        .eq('direction', 'in'),
      supabase.from('business_settings').select('*').maybeSingle(),
      supabase.from('brand_settings').select('*').maybeSingle(),
    ]);

  if (!order) notFound();

  const customerEmbedded = order.customers as unknown as
    | { name: string; document_number: string | null }
    | { name: string; document_number: string | null }[]
    | null;
  const customer = Array.isArray(customerEmbedded) ? customerEmbedded[0] : customerEmbedded;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>

      <article className="print-a4 rounded-xl border border-madera-200 bg-white p-8">
        <header className="flex items-start justify-between border-b border-madera-300 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-madera-900">Punto Madera</h1>
            {brand?.address && <p className="text-sm text-madera-600">{brand.address}</p>}
            {brand?.phone && <p className="text-sm text-madera-600">Tel. {brand.phone}</p>}
            {brand?.instagram && <p className="text-sm text-madera-600">{brand.instagram}</p>}
          </div>
          <div className="text-right">
            <p className="text-sm text-madera-500">Comprobante no fiscal</p>
            <p className="text-xl font-semibold text-madera-900">{order.number}</p>
            <p className="text-sm text-madera-600">{formatDateTime(order.created_at)}</p>
            {order.status === 'cancelled' && (
              <p className="mt-1 font-semibold text-fuego-600">ANULADO</p>
            )}
          </div>
        </header>

        <section className="border-b border-madera-200 py-3">
          <p className="text-sm text-madera-600">
            Cliente: <strong className="text-madera-900">{customer?.name ?? 'Consumidor final'}</strong>
            {customer?.document_number && ` · ${customer.document_number}`}
          </p>
        </section>

        <table className="w-full py-4 text-sm">
          <thead>
            <tr className="border-b border-madera-200 text-left text-xs text-madera-500">
              <th className="py-2 font-medium">Detalle</th>
              <th className="py-2 text-right font-medium">Cant.</th>
              <th className="py-2 text-right font-medium">Precio</th>
              <th className="py-2 text-right font-medium">Importe</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((item) => (
              <tr key={item.id} className="border-b border-madera-100">
                <td className="py-2">
                  <p className="text-madera-900">{item.name_snapshot}</p>
                  <p className="text-xs text-madera-500">{item.sku_snapshot}</p>
                  {!Money.parse(item.discount_amount).isZero() && (
                    <p className="text-xs text-fuego-600">
                      Precio de lista {formatMoney(item.list_price)} · descuento{' '}
                      {formatMoney(item.discount_amount)}
                    </p>
                  )}
                </td>
                <td className="tabular py-2 text-right">{formatQuantity(item.quantity)}</td>
                <td className="tabular py-2 text-right">{formatMoney(item.unit_price)}</td>
                <td className="tabular py-2 text-right font-medium">
                  {formatMoney(item.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="ml-auto w-64 space-y-1 border-t border-madera-300 pt-3 text-sm">
          <Line label="Subtotal" value={formatMoney(order.subtotal)} />
          {!Money.parse(order.discount_total).isZero() && (
            <Line label="Descuentos" value={`− ${formatMoney(order.discount_total)}`} />
          )}
          {!Money.parse(order.shipping_total).isZero() && (
            <Line label="Envío" value={formatMoney(order.shipping_total)} />
          )}
          <div className="flex justify-between border-t border-madera-300 pt-2 text-base font-bold">
            <span>Total</span>
            <span className="tabular">{formatMoney(order.total)}</span>
          </div>
          {(payments ?? []).map((p, index) => {
            // PostgREST devuelve la relación embebida como arreglo o como objeto
            // según la cardinalidad que infiera; se contemplan ambas formas.
            const embedded = p.payment_methods as unknown as
              | { name: string }
              | { name: string }[]
              | null;
            const method = Array.isArray(embedded) ? embedded[0] : embedded;
            return (
              <Line
                key={index}
                label={`${method?.name ?? 'Pago'}${p.status === 'pending' ? ' (a confirmar)' : ''}`}
                value={formatMoney(p.amount)}
              />
            );
          })}
          {(payments ?? []).some((p) => !Money.parse(p.change_given).isZero()) && (
            <Line
              label="Vuelto"
              value={formatMoney(
                Money.sum((payments ?? []).map((p) => Money.parse(p.change_given))),
              )}
            />
          )}
          {!Money.parse(order.balance_due).isZero() && (
            <div className="flex justify-between font-semibold text-fuego-600">
              <span>Saldo pendiente</span>
              <span className="tabular">{formatMoney(order.balance_due)}</span>
            </div>
          )}
        </section>

        <footer className="mt-8 space-y-1 border-t border-madera-200 pt-4 text-xs text-madera-500">
          {settings?.receipt_exchange_policy && <p>{settings.receipt_exchange_policy}</p>}
          {settings?.receipt_wood_notice && <p>{settings.receipt_wood_notice}</p>}
          {settings?.receipt_pickup_policy && <p>{settings.receipt_pickup_policy}</p>}
          {settings?.receipt_footer && <p>{settings.receipt_footer}</p>}
        </footer>
      </article>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-madera-600">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
