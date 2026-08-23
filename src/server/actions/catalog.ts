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

const productSchema = z.object({
  name: z.string().min(2, 'El nombre es obligatorio').max(160),
  kind: z.enum(['simple', 'variant', 'service', 'bundle_virtual', 'bundle_stocked']),
  category_id: z.string().uuid().nullable().optional(),
  short_description: z.string().max(300).optional(),
  brand: z.string().max(80).optional(),
  is_handcrafted: z.boolean().optional(),
  requires_customization: z.boolean().optional(),
  variants: z
    .array(
      z.object({
        sku: z.string().max(40).optional(),
        name: z.string().max(120).default(''),
        attributes: z.record(z.string(), z.string()).optional(),
        min_stock: z.number().nonnegative().default(0),
        price: money,
        preferred_location_id: z.string().uuid().nullable().optional(),
      }),
    )
    .min(1, 'Cargá al menos una variante'),
  components: z
    .array(
      z.object({
        component_variant_id: z.string().uuid(),
        quantity: z.number().positive(),
      }),
    )
    .optional(),
});

/**
 * Alta de producto con sus variantes y precios de lista.
 *
 * Los precios pasan por `set_variant_price` para que quede historial;
 * la inserción del producto usa las políticas de RLS de catálogo.
 */
export async function createProduct(
  input: z.input<typeof productSchema>,
): Promise<ActionResult<string>> {
  const session = await requireSession();
  if (session.role !== 'owner') {
    return fail('Solo el dueño puede administrar el catálogo.');
  }

  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');
  const data = parsed.data;

  const isBundle = data.kind === 'bundle_virtual' || data.kind === 'bundle_stocked';
  if (isBundle && (!data.components || data.components.length === 0)) {
    return fail('Un combo necesita al menos un componente.');
  }

  const supabase = await createClient();

  const { data: product, error: productError } = await supabase
    .from('products')
    .insert({
      organization_id: session.organizationId,
      name: data.name,
      kind: data.kind,
      category_id: data.category_id ?? null,
      short_description: data.short_description ?? null,
      brand: data.brand ?? null,
      is_handcrafted: data.is_handcrafted ?? false,
      requires_customization: data.requires_customization ?? false,
      is_inventoried: data.kind !== 'service',
    })
    .select('id')
    .single();

  if (productError || !product) return fail(describeError(productError));

  const { data: defaultList } = await supabase
    .from('price_lists')
    .select('id')
    .eq('is_default', true)
    .maybeSingle();

  for (const variant of data.variants) {
    let sku = variant.sku?.trim();
    if (!sku) {
      const { data: generated } = await supabase.rpc('next_sku', {});
      sku = (generated as string | null) ?? `SKU-${Date.now()}`;
    }

    const { data: created, error: variantError } = await supabase
      .from('product_variants')
      .insert({
        organization_id: session.organizationId,
        product_id: product.id,
        sku,
        name: variant.name,
        attributes: variant.attributes ?? {},
        min_stock: variant.min_stock,
        preferred_location_id: variant.preferred_location_id ?? null,
      })
      .select('id')
      .single();

    if (variantError || !created) return fail(describeError(variantError));

    if (defaultList) {
      const { error: priceError } = await supabase.rpc('set_variant_price', {
        p_variant: created.id,
        p_price_list: defaultList.id,
        p_price: variant.price,
        p_reason: 'Alta de producto',
        p_tax_rate: null,
      });
      if (priceError) return fail(describeError(priceError));
    }

    if (isBundle && data.components) {
      const { error: componentError } = await supabase.from('bundle_components').insert(
        data.components.map((c) => ({
          organization_id: session.organizationId,
          bundle_variant_id: created.id,
          component_variant_id: c.component_variant_id,
          quantity: c.quantity,
        })),
      );
      if (componentError) return fail(describeError(componentError));
    }
  }

  revalidatePath('/productos');
  revalidatePath('/venta');
  return ok(product.id);
}

const priceSchema = z.object({
  variant_id: z.string().uuid(),
  price_list_id: z.string().uuid(),
  price: money,
  reason: z.string().max(200).optional(),
});

export async function setVariantPrice(
  input: z.input<typeof priceSchema>,
): Promise<ActionResult<null>> {
  const session = await requireSession();
  if (session.role !== 'owner') return fail('Solo el dueño puede cambiar precios.');

  const parsed = priceSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_variant_price', {
    p_variant: parsed.data.variant_id,
    p_price_list: parsed.data.price_list_id,
    p_price: parsed.data.price,
    p_reason: parsed.data.reason ?? null,
    p_tax_rate: null,
  });

  if (error) return fail(describeError(error));
  revalidatePath('/productos');
  return ok(null);
}

const costSchema = z.object({
  variant_id: z.string().uuid(),
  last_cost: money,
  reason: z.string().max(200).optional(),
});

export async function setVariantCost(
  input: z.input<typeof costSchema>,
): Promise<ActionResult<null>> {
  const session = await requireSession();
  if (session.role !== 'owner') return fail('Solo el dueño puede cambiar costos.');

  const parsed = costSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_variant_cost', {
    p_variant: parsed.data.variant_id,
    p_last_cost: parsed.data.last_cost,
    p_reason: parsed.data.reason ?? null,
    p_source: 'manual',
    p_supplier: null,
  });

  if (error) return fail(describeError(error));
  revalidatePath('/productos');
  return ok(null);
}
