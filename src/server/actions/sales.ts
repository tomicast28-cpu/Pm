'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/server/session';
import { describeError, fail, ok, type ActionResult } from './result';
import { Money } from '@/lib/money';
import type { SaleResult } from '@/lib/types';

const decimal = z
  .string()
  .or(z.number())
  .transform((v) => Money.parse(v).toDecimalString());

const saleItemSchema = z.object({
  variant_id: z.string().uuid(),
  quantity: z.number().positive('La cantidad debe ser mayor a cero'),
  location_id: z.string().uuid().nullable().optional(),
  discount_amount: decimal.optional(),
  discount_reason: z.string().max(200).optional(),
});

const salePaymentSchema = z.object({
  payment_method_id: z.string().uuid(),
  amount: decimal,
  installments: z.number().int().positive().max(24).optional(),
  reference: z.string().max(120).optional(),
});

const createSaleSchema = z.object({
  items: z.array(saleItemSchema).min(1, 'La venta no tiene productos'),
  payments: z.array(salePaymentSchema).default([]),
  customer_id: z.string().uuid().nullable().optional(),
  price_list_id: z.string().uuid().nullable().optional(),
  channel_id: z.string().uuid().nullable().optional(),
  shipping_total: decimal.optional(),
  order_discount: z
    .object({
      amount: decimal,
      reason: z.string().max(200).optional(),
    })
    .nullable()
    .optional(),
  notes: z.string().max(500).optional(),
  // Generada en el cliente al abrir el cobro: el doble clic manda la misma.
  idempotency_key: z.string().min(8).max(80),
  allow_oversell: z.boolean().optional(),
  oversell_reason: z.string().max(200).optional(),
});

export type CreateSaleInput = z.input<typeof createSaleSchema>;

/**
 * Registra una venta inmediata.
 *
 * Toda la lógica vive en `create_instant_sale`: esta acción valida la forma de
 * los datos y delega. Así, aunque alguien llamara a la base por otro camino,
 * las reglas de negocio y los permisos se aplican igual.
 */
export async function createSale(input: CreateSaleInput): Promise<ActionResult<SaleResult>> {
  await requireSession();

  const parsed = createSaleSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos de la venta inválidos');
  }
  const data = parsed.data;

  const supabase = await createClient();
  const { data: result, error } = await supabase.rpc('create_instant_sale', {
    p_items: data.items,
    p_payments: data.payments,
    p_customer_id: data.customer_id ?? null,
    p_price_list_id: data.price_list_id ?? null,
    p_channel_id: data.channel_id ?? null,
    p_order_discount: data.order_discount ?? null,
    p_shipping_total: data.shipping_total ?? '0.00',
    p_notes: data.notes ?? null,
    p_idempotency_key: data.idempotency_key,
    p_allow_oversell: data.allow_oversell ?? false,
    p_oversell_reason: data.oversell_reason ?? null,
    p_cash_session: null,
  });

  if (error) return fail(describeError(error));

  revalidatePath('/');
  revalidatePath('/caja');
  revalidatePath('/stock');
  return ok(result as SaleResult);
}

const reverseSchema = z.object({
  order_id: z.string().uuid(),
  reason: z.string().min(3, 'Escribí el motivo de la reversión').max(300),
});

export async function reverseSale(
  input: z.input<typeof reverseSchema>,
): Promise<ActionResult<null>> {
  const session = await requireSession();
  if (session.role !== 'owner') return fail('Solo el dueño puede revertir una venta.');

  const parsed = reverseSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { error } = await supabase.rpc('reverse_sale', {
    p_order: parsed.data.order_id,
    p_reason: parsed.data.reason,
  });

  if (error) return fail(describeError(error));

  revalidatePath('/');
  revalidatePath('/caja');
  revalidatePath('/stock');
  return ok(null);
}

const lostSaleSchema = z.object({
  variant_id: z.string().uuid().nullable().optional(),
  product_text: z.string().max(200).optional(),
  reason: z.enum(['no_stock', 'price', 'size', 'color', 'thinking', 'other']),
  quantity: z.number().positive().default(1),
  notes: z.string().max(300).optional(),
});

/** Registro de venta perdida (22.8). Debe demorar pocos segundos. */
export async function recordLostSale(
  input: z.input<typeof lostSaleSchema>,
): Promise<ActionResult<null>> {
  const session = await requireSession();
  const parsed = lostSaleSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { error } = await supabase.from('lost_sales').insert({
    organization_id: session.organizationId,
    branch_id: session.branchId,
    variant_id: parsed.data.variant_id ?? null,
    product_text: parsed.data.product_text ?? null,
    reason: parsed.data.reason,
    quantity: parsed.data.quantity,
    notes: parsed.data.notes ?? null,
    created_by: session.userId,
  });

  if (error) return fail(describeError(error));
  return ok(null);
}
