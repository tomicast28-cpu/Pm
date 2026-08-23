'use client';

import { useState, useTransition } from 'react';
import { Money } from '@/lib/money';
import { formatMoney, formatDateTime } from '@/lib/format';
import {
  closeCashSession,
  openCashSession,
  recordCashMovement,
  reopenCashSession,
} from '@/server/actions/cash';
import { Badge, Button, Card, EmptyState, Field, Input, Select } from '@/components/ui';
import { cn } from '@/lib/cn';

type Expected = {
  payment_method_id: string;
  label: string;
  affects_drawer: boolean;
  expected_amount: string;
};

type SessionRow = {
  id: string;
  number: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: string;
  expected_cash: string | null;
  declared_cash: string | null;
  cash_difference: string | null;
  reopened_count: number;
};

export function CashScreen({
  registers,
  openSession,
  expected,
  movements,
  recentSessions,
  isOwner,
}: {
  registers: { id: string; name: string }[];
  openSession: (SessionRow & Record<string, unknown>) | null;
  expected: Expected[];
  movements: {
    id: string;
    movement_type: string;
    amount: string;
    description: string | null;
    created_at: string;
    affects_drawer: boolean;
  }[];
  recentSessions: SessionRow[];
  isOwner: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!openSession) {
    return (
      <OpenCashForm
        registers={registers}
        recentSessions={recentSessions}
        isOwner={isOwner}
        error={error}
        setError={setError}
      />
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-madera-900">Caja {openSession.number}</h1>
          <p className="text-sm text-madera-500">
            Abierta el {formatDateTime(openSession.opened_at)} · Inicial{' '}
            {formatMoney(openSession.opening_amount)}
          </p>
        </div>
        <Badge tone="good">Abierta</Badge>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <CloseCashForm
          sessionId={openSession.id}
          expected={expected}
          setError={setError}
          pending={pending}
          startTransition={startTransition}
        />

        <div className="space-y-4">
          <MovementForm sessionId={openSession.id} setError={setError} />

          <Card title="Movimientos del día">
            {movements.length === 0 ? (
              <EmptyState title="Sin movimientos todavía" />
            ) : (
              <ul className="max-h-80 divide-y divide-madera-100 overflow-y-auto">
                {movements.map((m) => {
                  const amount = Money.parse(m.amount);
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-madera-800">
                          {m.description ?? MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}
                        </p>
                        <p className="text-xs text-madera-500">
                          {formatDateTime(m.created_at)}
                          {!m.affects_drawer && ' · no toca el cajón'}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'tabular text-sm font-medium',
                          amount.isNegative() ? 'text-fuego-600' : 'text-emerald-700',
                        )}
                      >
                        {formatMoney(amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

const MOVEMENT_LABELS: Record<string, string> = {
  opening: 'Apertura',
  sale: 'Venta',
  refund: 'Devolución',
  income: 'Ingreso',
  withdrawal: 'Retiro',
  expense: 'Gasto',
  supplier_payment: 'Pago a proveedor',
  adjustment: 'Ajuste',
};

function OpenCashForm({
  registers,
  recentSessions,
  isOwner,
  error,
  setError,
}: {
  registers: { id: string; name: string }[];
  recentSessions: SessionRow[];
  isOwner: boolean;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const [registerId, setRegisterId] = useState(registers[0]?.id ?? '');
  const [amount, setAmount] = useState('0');
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-madera-900">Caja</h1>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Card title="Abrir caja" className="max-w-md">
        <div className="space-y-3 p-4">
          <Field label="Caja">
            <Select value={registerId} onChange={(e) => setRegisterId(e.target.value)}>
              {registers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Efectivo inicial" hint="Contá el dinero que hay en el cajón.">
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="tabular"
            />
          </Field>
          <Button
            size="lg"
            className="w-full"
            disabled={pending || !registerId}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await openCashSession({
                  register_id: registerId,
                  opening_amount: amount,
                });
                if (!result.ok) setError(result.error);
              })
            }
          >
            {pending ? 'Abriendo…' : 'Abrir caja'}
          </Button>
        </div>
      </Card>

      <Card title="Cierres recientes">
        {recentSessions.length === 0 ? (
          <EmptyState title="Todavía no hubo cierres" />
        ) : (
          <ul className="divide-y divide-madera-100">
            {recentSessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div>
                  <p className="text-sm text-madera-800">{s.number}</p>
                  <p className="text-xs text-madera-500">
                    {formatDateTime(s.opened_at)} → {formatDateTime(s.closed_at)}
                    {s.reopened_count > 0 && ` · reabierta ${s.reopened_count}×`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {s.cash_difference && !Money.parse(s.cash_difference).isZero() && (
                    <Badge tone="warn">Dif. {formatMoney(s.cash_difference)}</Badge>
                  )}
                  {isOwner && s.status === 'closed' && (
                    <ReopenButton sessionId={s.id} setError={setError} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ReopenButton({
  sessionId,
  setError,
}: {
  sessionId: string;
  setError: (e: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        const reason = window.prompt('Motivo de la reapertura (queda auditado):');
        if (!reason) return;
        startTransition(async () => {
          setError(null);
          const result = await reopenCashSession({ session_id: sessionId, reason });
          if (!result.ok) setError(result.error);
        });
      }}
    >
      Reabrir
    </Button>
  );
}

function CloseCashForm({
  sessionId,
  expected,
  setError,
  pending,
  startTransition,
}: {
  sessionId: string;
  expected: Expected[];
  setError: (e: string | null) => void;
  pending: boolean;
  startTransition: (fn: () => void) => void;
}) {
  const [declared, setDeclared] = useState<Record<string, { amount: string; reason: string }>>(
    () =>
      Object.fromEntries(
        expected.map((e) => [e.payment_method_id, { amount: e.expected_amount, reason: '' }]),
      ),
  );
  const [notes, setNotes] = useState('');

  return (
    <Card title="Cierre de caja">
      <div className="space-y-3 p-4">
        <p className="text-sm text-madera-600">
          Declará lo que hay realmente por cada medio. El sistema calcula la diferencia y pide
          motivo cuando no es cero.
        </p>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-madera-200 text-left text-xs text-madera-500">
              <th className="py-1.5 font-medium">Medio</th>
              <th className="py-1.5 text-right font-medium">Esperado</th>
              <th className="py-1.5 text-right font-medium">Declarado</th>
              <th className="py-1.5 text-right font-medium">Dif.</th>
            </tr>
          </thead>
          <tbody>
            {expected.map((row) => {
              const entry = declared[row.payment_method_id] ?? { amount: '0', reason: '' };
              const difference = safeMoney(entry.amount).subtract(
                Money.parse(row.expected_amount),
              );
              const hasDifference = !difference.isZero();

              return (
                <tr key={row.payment_method_id} className="border-b border-madera-100 align-top">
                  <td className="py-2">
                    <span className="text-madera-800">{row.label}</span>
                    {hasDifference && (
                      <input
                        value={entry.reason}
                        onChange={(e) =>
                          setDeclared((prev) => ({
                            ...prev,
                            [row.payment_method_id]: { ...entry, reason: e.target.value },
                          }))
                        }
                        placeholder="Motivo de la diferencia"
                        aria-label={`Motivo de la diferencia en ${row.label}`}
                        className="mt-1 w-full rounded border border-amber-300 px-2 py-1 text-xs"
                      />
                    )}
                  </td>
                  <td className="tabular py-2 text-right text-madera-600">
                    {formatMoney(row.expected_amount)}
                  </td>
                  <td className="py-2 text-right">
                    <input
                      value={entry.amount}
                      onChange={(e) =>
                        setDeclared((prev) => ({
                          ...prev,
                          [row.payment_method_id]: { ...entry, amount: e.target.value },
                        }))
                      }
                      inputMode="decimal"
                      aria-label={`Declarado ${row.label}`}
                      className="tabular w-28 rounded border border-madera-300 px-2 py-1 text-right"
                    />
                  </td>
                  <td
                    className={cn(
                      'tabular py-2 text-right font-medium',
                      hasDifference ? 'text-fuego-600' : 'text-madera-400',
                    )}
                  >
                    {formatMoney(difference)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <Field label="Observaciones del cierre">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <Button
          size="lg"
          className="w-full"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await closeCashSession({
                session_id: sessionId,
                declared: Object.fromEntries(
                  Object.entries(declared).map(([id, v]) => [
                    id,
                    { amount: v.amount, reason: v.reason || undefined },
                  ]),
                ),
                notes: notes || undefined,
              });
              if (!result.ok) setError(result.error);
            })
          }
        >
          {pending ? 'Cerrando…' : 'Cerrar caja'}
        </Button>
      </div>
    </Card>
  );
}

function MovementForm({
  sessionId,
  setError,
}: {
  sessionId: string;
  setError: (e: string | null) => void;
}) {
  const [type, setType] = useState<'income' | 'withdrawal' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <Card title="Ingreso, retiro o gasto">
      <div className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Tipo">
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="expense">Gasto</option>
              <option value="withdrawal">Retiro</option>
              <option value="income">Ingreso extraordinario</option>
            </Select>
          </Field>
          <Field label="Importe">
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="tabular"
            />
          </Field>
        </div>
        <Field label="Descripción">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej.: compra de bolsas"
          />
        </Field>
        <Button
          variant="secondary"
          className="w-full"
          disabled={pending || !amount || description.length < 2}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await recordCashMovement({
                session_id: sessionId,
                type,
                amount,
                description,
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setAmount('');
              setDescription('');
            })
          }
        >
          {pending ? 'Registrando…' : 'Registrar movimiento'}
        </Button>
      </div>
    </Card>
  );
}

function safeMoney(input: string): Money {
  try {
    return Money.parse(input);
  } catch {
    return Money.zero;
  }
}
