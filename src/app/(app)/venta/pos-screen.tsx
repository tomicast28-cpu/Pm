'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Money } from '@/lib/money';
import { formatMoney, formatQuantity } from '@/lib/format';
import { resolvePrice, type PriceListRule, type VariantPriceRow } from '@/lib/pricing';
import { createSale } from '@/server/actions/sales';
import { Badge, Button, Card, EmptyState, Field, Input, Select, inputClass } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { PaymentMethod, PosCatalogItem, SaleResult, StockLocation } from '@/lib/types';

type Customer = {
  id: string;
  name: string;
  customer_type: string;
  is_walk_in: boolean;
  price_list_id: string | null;
  credit_enabled: boolean;
};

type Line = {
  key: string;
  item: PosCatalogItem;
  quantity: number;
  discountInput: string;
  discountReason: string;
};

type PaymentRow = {
  key: string;
  methodId: string;
  amountInput: string;
  reference: string;
  installments: number;
};

export function PosScreen({
  catalog,
  paymentMethods,
  priceLists,
  variantPrices,
  locations,
  customers,
  channels,
  cashSessionOpen,
  isOwner,
}: {
  catalog: PosCatalogItem[];
  paymentMethods: PaymentMethod[];
  priceLists: PriceListRule[];
  variantPrices: VariantPriceRow[];
  locations: StockLocation[];
  customers: Customer[];
  channels: { id: string; code: string; name: string }[];
  cashSessionOpen: boolean;
  isOwner: boolean;
}) {
  const defaultList = priceLists.find((l) => l.is_default) ?? priceLists[0];
  const walkIn = customers.find((c) => c.is_walk_in);

  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [lines, setLines] = useState<Line[]>([]);
  const [priceListId, setPriceListId] = useState(defaultList?.id ?? '');
  const [customerId, setCustomerId] = useState(walkIn?.id ?? '');
  const [channelId, setChannelId] = useState('');
  const [locationId, setLocationId] = useState(
    locations.find((l) => l.is_default)?.id ?? locations[0]?.id ?? '',
  );
  const [orderDiscountInput, setOrderDiscountInput] = useState('');
  const [orderDiscountReason, setOrderDiscountReason] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<SaleResult | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of catalog) {
      if (item.category_id && item.category_name) map.set(item.category_id, item.category_name);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es-AR'));
  }, [catalog]);

  const normalizedQuery = useMemo(
    () =>
      query
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, ''),
    [query],
  );

  // Búsqueda por nombre, SKU, categoría o palabras parciales (4.1).
  const results = useMemo(() => {
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    return catalog
      .filter((item) => {
        if (categoryId && item.category_id !== categoryId) return false;
        if (terms.length === 0) return true;
        const haystack = `${item.search_text} ${item.category_name ?? ''}`.toLowerCase();
        return terms.every((t) => haystack.includes(t));
      })
      .slice(0, 60);
  }, [catalog, normalizedQuery, categoryId]);

  const priceOf = useCallback(
    (variantId: string) => resolvePrice(variantId, priceListId, priceLists, variantPrices),
    [priceListId, priceLists, variantPrices],
  );

  const computed = useMemo(() => {
    const rows = lines.map((line) => {
      const listPrice = priceOf(line.item.variant_id) ?? Money.zero;
      const discount = safeMoney(line.discountInput);
      const capped = discount.compare(listPrice) > 0 ? listPrice : discount;
      const unit = listPrice.subtract(capped);
      return { line, listPrice, discount: capped, unit, total: unit.multiply(line.quantity) };
    });

    const itemsTotal = Money.sum(rows.map((r) => r.total));
    const lineDiscounts = Money.sum(rows.map((r) => r.discount.multiply(r.line.quantity)));
    const orderDiscountRaw = safeMoney(orderDiscountInput);
    const orderDiscount =
      orderDiscountRaw.compare(itemsTotal) > 0 ? itemsTotal : orderDiscountRaw;
    const total = itemsTotal.subtract(orderDiscount);

    return { rows, itemsTotal, lineDiscounts, orderDiscount, total };
  }, [lines, priceOf, orderDiscountInput]);

  const paidTotal = useMemo(
    () => Money.sum(payments.map((p) => safeMoney(p.amountInput))),
    [payments],
  );
  const remaining = computed.total.subtract(paidTotal);
  const change = remaining.isNegative() ? remaining.negate() : Money.zero;

  const addLine = useCallback(
    (item: PosCatalogItem) => {
      setLastSale(null);
      setLines((prev) => {
        const existing = prev.find((l) => l.item.variant_id === item.variant_id);
        if (existing) {
          return prev.map((l) =>
            l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l,
          );
        }
        return [
          ...prev,
          {
            key: `${item.variant_id}-${Date.now()}`,
            item,
            quantity: 1,
            discountInput: '',
            discountReason: '',
          },
        ];
      });
    },
    [],
  );

  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const resetCart = () => {
    setLines([]);
    setPayments([]);
    setOrderDiscountInput('');
    setOrderDiscountReason('');
    setCheckoutOpen(false);
    setIdempotencyKey('');
    setError(null);
  };

  const openCheckout = useCallback(() => {
    if (lines.length === 0) return;
    setError(null);
    // La clave se genera UNA vez por cobro: si el usuario hace doble clic en
    // «Confirmar», la base recibe la misma clave y devuelve la misma venta.
    setIdempotencyKey((prev) => prev || crypto.randomUUID());
    setPayments((prev) =>
      prev.length > 0
        ? prev
        : [
            {
              key: crypto.randomUUID(),
              methodId: paymentMethods[0]?.id ?? '',
              amountInput: computed.total.toDecimalString(),
              reference: '',
              installments: 1,
            },
          ],
    );
    setCheckoutOpen(true);
  }, [lines.length, paymentMethods, computed.total]);

  // Atajos de teclado (6.4).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F4') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === 'F8') {
        event.preventDefault();
        openCheckout();
      } else if (event.key === 'Escape') {
        setCheckoutOpen(false);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openCheckout]);

  async function confirmSale() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const result = await createSale({
      items: computed.rows.map((row) => ({
        variant_id: row.line.item.variant_id,
        quantity: row.line.quantity,
        location_id: locationId || null,
        discount_amount: row.discount.toDecimalString(),
        discount_reason: row.line.discountReason || undefined,
      })),
      payments: payments
        .filter((p) => p.methodId && !safeMoney(p.amountInput).isZero())
        .map((p) => ({
          payment_method_id: p.methodId,
          amount: safeMoney(p.amountInput).toDecimalString(),
          installments: p.installments,
          reference: p.reference || undefined,
        })),
      customer_id: customerId || null,
      price_list_id: priceListId || null,
      channel_id: channelId || null,
      order_discount: computed.orderDiscount.isZero()
        ? null
        : {
            amount: computed.orderDiscount.toDecimalString(),
            reason: orderDiscountReason || undefined,
          },
      idempotency_key: idempotencyKey,
    });

    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setLastSale(result.data);
    resetCart();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      {/* ------------------------------------------------------------------ */}
      {/* Izquierda: buscador, categorías y grilla                            */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, SKU o categoría…  (F4)"
            aria-label="Buscar producto"
            className="min-w-60 flex-1"
            autoFocus
          />
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-label="Categoría"
            className="w-44"
          >
            <option value="">Todas las categorías</option>
            {categories.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </div>

        {results.length === 0 ? (
          <Card>
            <EmptyState
              title="Sin resultados"
              description="Probá con otra palabra, el SKU o cambiá la categoría."
            />
          </Card>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((item) => {
              const price = priceOf(item.variant_id);
              const available = Number(item.available_qty);
              const isService = !item.is_inventoried;
              const soldOut = !isService && available <= 0;

              return (
                <li key={item.variant_id}>
                  <button
                    type="button"
                    onClick={() => addLine(item)}
                    disabled={soldOut && !isOwner}
                    className={cn(
                      'flex w-full flex-col items-start gap-1 rounded-xl border bg-white px-3 py-2.5 text-left transition-colors',
                      soldOut
                        ? 'border-madera-200 opacity-60'
                        : 'border-madera-200 hover:border-madera-400 hover:bg-madera-50',
                    )}
                  >
                    <span className="line-clamp-2 text-sm font-medium text-madera-900">
                      {item.display_name}
                    </span>
                    <span className="text-xs text-madera-500">{item.sku}</span>
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="tabular text-sm font-semibold text-madera-800">
                        {price ? formatMoney(price) : 'Sin precio'}
                      </span>
                      {isService ? (
                        <Badge tone="info">Servicio</Badge>
                      ) : soldOut ? (
                        <Badge tone="bad">Sin stock</Badge>
                      ) : (
                        <Badge tone={available <= Number(item.min_stock) ? 'warn' : 'neutral'}>
                          {formatQuantity(available)} disp.
                        </Badge>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Derecha: carrito                                                    */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-3">
        {!cashSessionOpen && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            La caja está cerrada. Abrila desde <Link href="/caja" className="underline">Caja</Link>{' '}
            para poder cobrar.
          </div>
        )}

        {lastSale && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-3">
            <p className="text-sm font-medium text-emerald-900">
              Venta {lastSale.number} registrada · {formatMoney(lastSale.total)}
            </p>
            {!Money.parse(lastSale.change).isZero() && (
              <p className="text-sm text-emerald-800">
                Vuelto: <strong>{formatMoney(lastSale.change)}</strong>
              </p>
            )}
            <Link
              href={`/comprobante/${lastSale.order_id}`}
              className="mt-1 inline-block text-sm text-emerald-800 underline"
            >
              Ver e imprimir comprobante
            </Link>
          </div>
        )}

        <Card>
          <div className="grid gap-2 border-b border-madera-100 p-3 sm:grid-cols-2">
            <Field label="Cliente">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.customer_type === 'wholesale' ? ' (mayorista)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lista de precios">
              <Select value={priceListId} onChange={(e) => setPriceListId(e.target.value)}>
                {priceLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sale del stock de">
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Canal">
              <Select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                <option value="">Local</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {computed.rows.length === 0 ? (
            <EmptyState
              title="Carrito vacío"
              description="Buscá un producto y hacé clic para agregarlo."
            />
          ) : (
            <ul className="divide-y divide-madera-100">
              {computed.rows.map(({ line, listPrice, unit, total }) => (
                <li key={line.key} className="space-y-2 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-madera-900">
                        {line.item.display_name}
                      </p>
                      <p className="text-xs text-madera-500">
                        {line.item.sku} · {formatMoney(listPrice)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      className="text-xs text-fuego-600 underline"
                      aria-label={`Quitar ${line.item.display_name}`}
                    >
                      Quitar
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center rounded-lg border border-madera-300">
                      <button
                        type="button"
                        className="px-2.5 py-1 text-madera-700"
                        onClick={() =>
                          updateLine(line.key, { quantity: Math.max(1, line.quantity - 1) })
                        }
                        aria-label="Restar uno"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(line.key, {
                            quantity: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                        className="tabular w-14 border-x border-madera-300 py-1 text-center text-sm"
                        aria-label="Cantidad"
                      />
                      <button
                        type="button"
                        className="px-2.5 py-1 text-madera-700"
                        onClick={() => updateLine(line.key, { quantity: line.quantity + 1 })}
                        aria-label="Sumar uno"
                      >
                        +
                      </button>
                    </div>

                    <input
                      value={line.discountInput}
                      onChange={(e) => updateLine(line.key, { discountInput: e.target.value })}
                      placeholder="Desc. $"
                      inputMode="decimal"
                      aria-label="Descuento por unidad"
                      className={cn(inputClass, 'w-24 py-1 text-sm')}
                    />

                    <span className="tabular ml-auto text-sm font-semibold text-madera-900">
                      {formatMoney(total)}
                    </span>
                  </div>

                  {!safeMoney(line.discountInput).isZero() && (
                    <input
                      value={line.discountReason}
                      onChange={(e) => updateLine(line.key, { discountReason: e.target.value })}
                      placeholder="Motivo del descuento (queda registrado)"
                      className={cn(inputClass, 'py-1 text-xs')}
                      aria-label="Motivo del descuento"
                    />
                  )}

                  {!safeMoney(line.discountInput).isZero() && (
                    <p className="text-xs text-madera-500">
                      {formatMoney(listPrice)} → <strong>{formatMoney(unit)}</strong> por unidad
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Pie fijo con totales (6.4) */}
          <footer className="space-y-1.5 border-t border-madera-200 bg-madera-50 p-3">
            <Row label="Subtotal" value={formatMoney(computed.itemsTotal)} />
            {!computed.lineDiscounts.isZero() && (
              <Row
                label="Descuentos por línea"
                value={`− ${formatMoney(computed.lineDiscounts)}`}
                tone="discount"
              />
            )}
            <div className="flex items-center gap-2 py-1">
              <input
                value={orderDiscountInput}
                onChange={(e) => setOrderDiscountInput(e.target.value)}
                placeholder="Descuento general $"
                inputMode="decimal"
                aria-label="Descuento general"
                className={cn(inputClass, 'py-1 text-xs')}
              />
              {!computed.orderDiscount.isZero() && (
                <input
                  value={orderDiscountReason}
                  onChange={(e) => setOrderDiscountReason(e.target.value)}
                  placeholder="Motivo"
                  aria-label="Motivo del descuento general"
                  className={cn(inputClass, 'py-1 text-xs')}
                />
              )}
            </div>
            <div className="flex items-baseline justify-between border-t border-madera-200 pt-2">
              <span className="text-sm font-medium text-madera-700">Total</span>
              <span className="tabular text-2xl font-bold text-madera-900">
                {formatMoney(computed.total)}
              </span>
            </div>
            <Button
              size="lg"
              className="w-full"
              onClick={openCheckout}
              disabled={computed.rows.length === 0 || !cashSessionOpen}
            >
              Cobrar (F8)
            </Button>
          </footer>
        </Card>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Cobro                                                               */}
      {/* ------------------------------------------------------------------ */}
      {checkoutOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Cobrar"
          onClick={(e) => e.target === e.currentTarget && setCheckoutOpen(false)}
        >
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-madera-900">Cobrar</h2>
              <button
                type="button"
                onClick={() => setCheckoutOpen(false)}
                className="text-sm text-madera-500 underline"
              >
                Cerrar (Esc)
              </button>
            </div>

            <p className="tabular mt-2 text-3xl font-bold text-madera-900">
              {formatMoney(computed.total)}
            </p>

            <ul className="mt-4 space-y-2">
              {payments.map((payment) => {
                const method = paymentMethods.find((m) => m.id === payment.methodId);
                return (
                  <li key={payment.key} className="rounded-lg border border-madera-200 p-2">
                    <div className="flex gap-2">
                      <Select
                        value={payment.methodId}
                        onChange={(e) =>
                          setPayments((prev) =>
                            prev.map((p) =>
                              p.key === payment.key ? { ...p, methodId: e.target.value } : p,
                            ),
                          )
                        }
                        aria-label="Medio de pago"
                        className="flex-1"
                      >
                        {paymentMethods.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </Select>
                      <input
                        value={payment.amountInput}
                        onChange={(e) =>
                          setPayments((prev) =>
                            prev.map((p) =>
                              p.key === payment.key ? { ...p, amountInput: e.target.value } : p,
                            ),
                          )
                        }
                        inputMode="decimal"
                        aria-label="Importe"
                        className={cn(inputClass, 'tabular w-32 text-right')}
                      />
                      {payments.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setPayments((prev) => prev.filter((p) => p.key !== payment.key))
                          }
                          className="px-1 text-fuego-600"
                          aria-label="Quitar pago"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    {method?.requires_confirmation && (
                      <p className="mt-1 text-xs text-amber-700">
                        Queda pendiente de confirmación hasta que verifiques el ingreso.
                      </p>
                    )}
                    {Number(method?.commission_rate ?? 0) > 0 && isOwner && (
                      <p className="mt-1 text-xs text-madera-500">
                        Comisión:{' '}
                        {formatMoney(safeMoney(payment.amountInput).rate(method!.commission_rate))}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              onClick={() =>
                setPayments((prev) => [
                  ...prev,
                  {
                    key: crypto.randomUUID(),
                    methodId: paymentMethods[0]?.id ?? '',
                    amountInput: remaining.isNegative() ? '0' : remaining.toDecimalString(),
                    reference: '',
                    installments: 1,
                  },
                ])
              }
              className="mt-2 text-sm text-madera-700 underline"
            >
              + Agregar otro medio de pago
            </button>

            <dl className="mt-4 space-y-1 rounded-lg bg-madera-50 p-3">
              <Row label="Total" value={formatMoney(computed.total)} />
              <Row label="Cobrado" value={formatMoney(paidTotal)} />
              {remaining.isNegative() ? (
                <Row label="Vuelto" value={formatMoney(change)} tone="change" />
              ) : (
                <Row label="Falta" value={formatMoney(remaining)} tone="due" />
              )}
            </dl>

            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <Button
              size="lg"
              className="mt-4 w-full"
              onClick={confirmSale}
              disabled={submitting || payments.length === 0}
            >
              {submitting ? 'Registrando…' : 'Confirmar venta'}
            </Button>
            <p className="mt-2 text-center text-xs text-madera-500">
              Si hacés clic dos veces, la venta se registra una sola vez.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'discount' | 'due' | 'change';
}) {
  const tones: Record<string, string> = {
    discount: 'text-fuego-600',
    due: 'text-amber-700',
    change: 'text-emerald-700',
  };
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-madera-600">{label}</span>
      <span className={cn('tabular font-medium', tone ? tones[tone] : 'text-madera-900')}>
        {value}
      </span>
    </div>
  );
}

/** Nunca revienta por lo que se escriba en un campo de importe. */
function safeMoney(input: string): Money {
  try {
    return Money.parse(input);
  } catch {
    return Money.zero;
  }
}
