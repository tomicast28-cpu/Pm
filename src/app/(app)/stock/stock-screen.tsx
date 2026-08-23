'use client';

import { useMemo, useState, useTransition } from 'react';
import { Money } from '@/lib/money';
import { formatMoney, formatQuantity, formatDateTime } from '@/lib/format';
import { adjustStock, onlineSaleExit, transferStock } from '@/server/actions/stock';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Stat } from '@/components/ui';

type StockRow = {
  variant_id: string;
  sku: string;
  display_name: string;
  location_id: string;
  location_name: string;
  on_hand: string;
  reserved: string;
  available: string;
  min_stock: string;
  below_minimum: boolean;
};

const MOVEMENT_LABELS: Record<string, string> = {
  purchase_receipt: 'Ingreso por compra',
  sale: 'Venta',
  reservation: 'Reserva',
  reservation_release: 'Liberación de reserva',
  fulfillment: 'Entrega',
  online_sale_exit: 'Salida por venta online',
  transfer: 'Transferencia',
  adjustment_in: 'Ajuste positivo',
  adjustment_out: 'Ajuste negativo',
  damage: 'Daño',
  damage_recovery: 'Recuperación de daño',
  customer_return: 'Devolución de cliente',
  supplier_return: 'Devolución a proveedor',
  bundle_assemble: 'Armado de combo',
  bundle_disassemble: 'Desarmado de combo',
  initial_inventory: 'Inventario inicial',
  reversal: 'Reversión',
};

export function StockScreen({
  rows,
  locations,
  movements,
  aging,
  canTransfer,
  canAdjust,
  canOnlineExit,
  isOwner,
}: {
  rows: StockRow[];
  locations: { id: string; code: string; name: string }[];
  movements: {
    id: string;
    movement_type: string;
    reason: string | null;
    created_at: string;
    reference_type: string | null;
  }[];
  aging: { age_bucket: string; immobilized_value: string; remaining_quantity: string }[];
  canTransfer: boolean;
  canAdjust: boolean;
  canOnlineExit: boolean;
  isOwner: boolean;
}) {
  const [query, setQuery] = useState('');
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (locationId && r.location_id !== locationId) return false;
      if (!q) return true;
      return `${r.display_name} ${r.sku}`.toLowerCase().includes(q);
    });
  }, [rows, query, locationId]);

  const lowCount = rows.filter((r) => r.below_minimum).length;

  const agingByBucket = useMemo(() => {
    const buckets = new Map<string, Money>();
    for (const row of aging) {
      const current = buckets.get(row.age_bucket) ?? Money.zero;
      buckets.set(row.age_bucket, current.add(Money.parse(row.immobilized_value)));
    }
    return ['0-29', '30-59', '60-89', '90-179', '180+'].map((b) => ({
      bucket: b,
      value: buckets.get(b) ?? Money.zero,
    }));
  }, [aging]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-madera-900">Stock</h1>
          <p className="text-sm text-madera-500">
            Disponible = físico menos reservado. Mové entre ubicaciones con transferencias.
          </p>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
      )}

      {isOwner && aging.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {agingByBucket.map((b) => (
            <Stat
              key={b.bucket}
              label={`Inmovilizado ${b.bucket} días`}
              value={formatMoney(b.value)}
              tone={b.bucket === '180+' && !b.value.isZero() ? 'bad' : 'neutral'}
            />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card
          title={`Existencias${lowCount > 0 ? ` · ${lowCount} bajo mínimo` : ''}`}
          action={
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar…"
                className="w-40 py-1 text-xs"
                aria-label="Buscar producto"
              />
              <Select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-32 py-1 text-xs"
                aria-label="Ubicación"
              >
                <option value="">Todas</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
          }
        >
          {filtered.length === 0 ? (
            <EmptyState title="Sin existencias que mostrar" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-madera-200 text-left text-xs text-madera-500">
                    <th className="px-4 py-2 font-medium">Producto</th>
                    <th className="px-2 py-2 font-medium">Ubicación</th>
                    <th className="px-2 py-2 text-right font-medium">Físico</th>
                    <th className="px-2 py-2 text-right font-medium">Reservado</th>
                    <th className="px-4 py-2 text-right font-medium">Disponible</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={`${row.variant_id}-${row.location_id}`}
                      className="border-b border-madera-100"
                    >
                      <td className="px-4 py-2">
                        <p className="text-madera-900">{row.display_name}</p>
                        <p className="text-xs text-madera-500">{row.sku}</p>
                      </td>
                      <td className="px-2 py-2 text-madera-600">{row.location_name}</td>
                      <td className="tabular px-2 py-2 text-right">
                        {formatQuantity(row.on_hand)}
                      </td>
                      <td className="tabular px-2 py-2 text-right text-madera-500">
                        {formatQuantity(row.reserved)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {row.below_minimum ? (
                          <Badge tone="warn">{formatQuantity(row.available)}</Badge>
                        ) : (
                          <span className="tabular font-medium">
                            {formatQuantity(row.available)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          {canTransfer && (
            <TransferForm
              rows={rows}
              locations={locations}
              setError={setError}
              setNotice={setNotice}
            />
          )}
          {canOnlineExit && (
            <OnlineExitForm
              rows={rows}
              locations={locations}
              setError={setError}
              setNotice={setNotice}
            />
          )}
          {canAdjust && (
            <AdjustForm
              rows={rows}
              locations={locations}
              setError={setError}
              setNotice={setNotice}
            />
          )}

          <Card title="Últimos movimientos">
            {movements.length === 0 ? (
              <EmptyState title="Sin movimientos" />
            ) : (
              <ul className="max-h-72 divide-y divide-madera-100 overflow-y-auto">
                {movements.map((m) => (
                  <li key={m.id} className="px-4 py-2">
                    <p className="text-sm text-madera-800">
                      {MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}
                    </p>
                    <p className="text-xs text-madera-500">
                      {formatDateTime(m.created_at)}
                      {m.reason && ` · ${m.reason}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Opciones únicas por variante (una variante puede estar en varias ubicaciones). */
function useVariantOptions(rows: StockRow[]) {
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.variant_id, `${r.display_name} (${r.sku})`);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es-AR'));
  }, [rows]);
}

function TransferForm({
  rows,
  locations,
  setError,
  setNotice,
}: {
  rows: StockRow[];
  locations: { id: string; name: string }[];
  setError: (e: string | null) => void;
  setNotice: (n: string | null) => void;
}) {
  const options = useVariantOptions(rows);
  const [variantId, setVariantId] = useState('');
  const [from, setFrom] = useState(locations[0]?.id ?? '');
  const [to, setTo] = useState(locations[1]?.id ?? '');
  const [quantity, setQuantity] = useState('1');
  const [pending, startTransition] = useTransition();

  return (
    <Card title="Transferir entre ubicaciones">
      <div className="space-y-2 p-4">
        <Field label="Producto">
          <Select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            <option value="">Elegí un producto…</option>
            {options.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Desde">
            <Select value={from} onChange={(e) => setFrom(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hacia">
            <Select value={to} onChange={(e) => setTo(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Cantidad">
          <Input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            inputMode="decimal"
            className="tabular"
          />
        </Field>
        <Button
          variant="secondary"
          className="w-full"
          disabled={pending || !variantId || from === to}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              setNotice(null);
              const result = await transferStock({
                variant_id: variantId,
                from_location_id: from,
                to_location_id: to,
                quantity: Number(quantity),
                idempotency_key: crypto.randomUUID(),
              });
              if (!result.ok) setError(result.error);
              else setNotice('Transferencia registrada.');
            })
          }
        >
          {pending ? 'Transfiriendo…' : 'Transferir'}
        </Button>
      </div>
    </Card>
  );
}

function OnlineExitForm({
  rows,
  locations,
  setError,
  setNotice,
}: {
  rows: StockRow[];
  locations: { id: string; name: string }[];
  setError: (e: string | null) => void;
  setNotice: (n: string | null) => void;
}) {
  const options = useVariantOptions(rows);
  const [variantId, setVariantId] = useState('');
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [quantity, setQuantity] = useState('1');
  const [reference, setReference] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <Card title="Salida por venta online">
      <div className="space-y-2 p-4">
        <p className="text-xs text-madera-500">
          Descuenta stock sin registrar ingreso en caja: la venta ya se cobró afuera.
        </p>
        <Field label="Producto">
          <Select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            <option value="">Elegí un producto…</option>
            {options.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ubicación">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cantidad">
            <Input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              className="tabular"
            />
          </Field>
        </div>
        <Field label="Referencia" hint="Número de orden del canal externo (opcional).">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Button
          variant="secondary"
          className="w-full"
          disabled={pending || !variantId}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              setNotice(null);
              const result = await onlineSaleExit({
                variant_id: variantId,
                location_id: locationId,
                quantity: Number(quantity),
                channel_code: 'ecommerce',
                reference: reference || undefined,
                idempotency_key: crypto.randomUUID(),
              });
              if (!result.ok) setError(result.error);
              else setNotice('Salida online registrada.');
            })
          }
        >
          {pending ? 'Registrando…' : 'Registrar salida'}
        </Button>
      </div>
    </Card>
  );
}

function AdjustForm({
  rows,
  locations,
  setError,
  setNotice,
}: {
  rows: StockRow[];
  locations: { id: string; name: string }[];
  setError: (e: string | null) => void;
  setNotice: (n: string | null) => void;
}) {
  const options = useVariantOptions(rows);
  const [variantId, setVariantId] = useState('');
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <Card title="Ajuste manual">
      <div className="space-y-2 p-4">
        <p className="text-xs text-madera-500">
          Positivo suma, negativo resta. Queda auditado con su motivo.
        </p>
        <Field label="Producto">
          <Select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            <option value="">Elegí un producto…</option>
            {options.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ubicación">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cantidad">
            <Input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="-2"
              inputMode="decimal"
              className="tabular"
            />
          </Field>
        </div>
        <Field label="Motivo">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej.: rotura en depósito"
          />
        </Field>
        <Button
          variant="secondary"
          className="w-full"
          disabled={pending || !variantId || !quantity || reason.length < 3}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              setNotice(null);
              const result = await adjustStock({
                variant_id: variantId,
                location_id: locationId,
                quantity: Number(quantity),
                reason,
              });
              if (!result.ok) setError(result.error);
              else {
                setNotice('Ajuste registrado.');
                setQuantity('');
                setReason('');
              }
            })
          }
        >
          {pending ? 'Ajustando…' : 'Registrar ajuste'}
        </Button>
      </div>
    </Card>
  );
}
