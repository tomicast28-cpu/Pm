'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/server/session';
import { describeError, fail, ok, type ActionResult } from './result';

const transferSchema = z.object({
  variant_id: z.string().uuid(),
  from_location_id: z.string().uuid(),
  to_location_id: z.string().uuid(),
  quantity: z.number().positive('La cantidad debe ser mayor a cero'),
  reason: z.string().max(300).optional(),
  idempotency_key: z.string().min(8).max(80),
});

/** Mover entre Salón y Altillo. Nunca se editan cantidades a mano. */
export async function transferStock(
  input: z.input<typeof transferSchema>,
): Promise<ActionResult<string>> {
  await requireSession();
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');
  if (parsed.data.from_location_id === parsed.data.to_location_id) {
    return fail('El origen y el destino deben ser distintos.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('transfer_stock', {
    p_variant: parsed.data.variant_id,
    p_from_location: parsed.data.from_location_id,
    p_to_location: parsed.data.to_location_id,
    p_quantity: parsed.data.quantity,
    p_reason: parsed.data.reason ?? null,
    p_idempotency_key: parsed.data.idempotency_key,
  });

  if (error) return fail(describeError(error));
  revalidatePath('/stock');
  return ok(data as string);
}

const adjustSchema = z.object({
  variant_id: z.string().uuid(),
  location_id: z.string().uuid(),
  quantity: z.number().refine((v) => v !== 0, 'El ajuste no puede ser cero'),
  reason: z.string().min(3, 'El ajuste de stock requiere un motivo').max(300),
  unit_cost: z.number().nonnegative().optional(),
  state: z.enum(['available', 'damaged', 'display', 'in_transit', 'pending_receipt']).optional(),
});

export async function adjustStock(
  input: z.input<typeof adjustSchema>,
): Promise<ActionResult<string>> {
  const session = await requireSession();
  if (session.role !== 'owner') return fail('Solo el dueño puede ajustar stock manualmente.');

  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('adjust_stock', {
    p_variant: parsed.data.variant_id,
    p_location: parsed.data.location_id,
    p_quantity: parsed.data.quantity,
    p_reason: parsed.data.reason,
    p_unit_cost: parsed.data.unit_cost ?? 0,
    p_state: parsed.data.state ?? 'available',
  });

  if (error) return fail(describeError(error));
  revalidatePath('/stock');
  return ok(data as string);
}

const onlineExitSchema = z.object({
  variant_id: z.string().uuid(),
  location_id: z.string().uuid(),
  quantity: z.number().positive('La cantidad debe ser mayor a cero'),
  channel_code: z.string().max(40).default('ecommerce'),
  reference: z.string().max(120).optional(),
  idempotency_key: z.string().min(8).max(80),
});

/** Salida por venta online (8.8): baja stock, no genera ingreso en caja. */
export async function onlineSaleExit(
  input: z.input<typeof onlineExitSchema>,
): Promise<ActionResult<string>> {
  await requireSession();
  const parsed = onlineExitSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('online_sale_exit', {
    p_variant: parsed.data.variant_id,
    p_location: parsed.data.location_id,
    p_quantity: parsed.data.quantity,
    p_channel_code: parsed.data.channel_code,
    p_reference: parsed.data.reference ?? null,
    p_idempotency_key: parsed.data.idempotency_key,
  });

  if (error) return fail(describeError(error));
  revalidatePath('/stock');
  return ok(data as string);
}

const bundleSchema = z.object({
  bundle_variant_id: z.string().uuid(),
  location_id: z.string().uuid(),
  quantity: z.number().positive(),
  reason: z.string().max(300).optional(),
});

export async function assembleBundle(
  input: z.input<typeof bundleSchema>,
): Promise<ActionResult<string>> {
  await requireSession();
  const parsed = bundleSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('assemble_bundle', {
    p_bundle_variant: parsed.data.bundle_variant_id,
    p_location: parsed.data.location_id,
    p_quantity: parsed.data.quantity,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) return fail(describeError(error));
  revalidatePath('/stock');
  return ok(data as string);
}

export async function disassembleBundle(
  input: z.input<typeof bundleSchema>,
): Promise<ActionResult<string>> {
  await requireSession();
  const parsed = bundleSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('disassemble_bundle', {
    p_bundle_variant: parsed.data.bundle_variant_id,
    p_location: parsed.data.location_id,
    p_quantity: parsed.data.quantity,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) return fail(describeError(error));
  revalidatePath('/stock');
  return ok(data as string);
}
