'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/server/session';
import { describeError, fail, ok, type ActionResult } from './result';
import { Money } from '@/lib/money';

const money = z
  .string()
  .or(z.number())
  .transform((v) => Money.parse(v).toDecimalString());

const openSchema = z.object({
  register_id: z.string().uuid(),
  opening_amount: money,
  notes: z.string().max(300).optional(),
});

export async function openCashSession(
  input: z.input<typeof openSchema>,
): Promise<ActionResult<string>> {
  await requireSession();
  const parsed = openSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('open_cash_session', {
    p_register: parsed.data.register_id,
    p_opening_amount: parsed.data.opening_amount,
    p_notes: parsed.data.notes ?? null,
  });

  if (error) return fail(describeError(error));
  revalidatePath('/caja');
  revalidatePath('/');
  return ok(data as string);
}

const closeSchema = z.object({
  session_id: z.string().uuid(),
  declared: z.record(
    z.string().uuid(),
    z.object({ amount: money, reason: z.string().max(300).optional() }),
  ),
  notes: z.string().max(500).optional(),
});

export async function closeCashSession(
  input: z.input<typeof closeSchema>,
): Promise<ActionResult<unknown>> {
  await requireSession();
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('close_cash_session', {
    p_session: parsed.data.session_id,
    p_declared: parsed.data.declared,
    p_notes: parsed.data.notes ?? null,
  });

  if (error) return fail(describeError(error));
  revalidatePath('/caja');
  revalidatePath('/');
  return ok(data);
}

const reopenSchema = z.object({
  session_id: z.string().uuid(),
  reason: z.string().min(3, 'Escribí el motivo de la reapertura').max(300),
});

export async function reopenCashSession(
  input: z.input<typeof reopenSchema>,
): Promise<ActionResult<null>> {
  const session = await requireSession();
  if (session.role !== 'owner') return fail('Solo el dueño puede reabrir una caja cerrada.');

  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { error } = await supabase.rpc('reopen_cash_session', {
    p_session: parsed.data.session_id,
    p_reason: parsed.data.reason,
  });

  if (error) return fail(describeError(error));
  revalidatePath('/caja');
  return ok(null);
}

const movementSchema = z.object({
  session_id: z.string().uuid(),
  type: z.enum(['income', 'withdrawal', 'expense', 'supplier_payment', 'adjustment']),
  amount: money,
  description: z.string().min(2, 'Describí el movimiento').max(200),
  payment_method_id: z.string().uuid().nullable().optional(),
  reason: z.string().max(300).optional(),
});

export async function recordCashMovement(
  input: z.input<typeof movementSchema>,
): Promise<ActionResult<string>> {
  await requireSession();
  const parsed = movementSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('record_cash_movement', {
    p_session: parsed.data.session_id,
    p_type: parsed.data.type,
    p_amount: parsed.data.amount,
    p_description: parsed.data.description,
    p_payment_method: parsed.data.payment_method_id ?? null,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) return fail(describeError(error));
  revalidatePath('/caja');
  return ok(data as string);
}
