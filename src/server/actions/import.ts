'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/server/session';
import { describeError, fail, ok, type ActionResult } from './result';
import { parseCatalogWorkbook, buildErrorReport, type ParsedCatalog } from '@/server/import/catalog';

const MAX_BYTES = 8 * 1024 * 1024;

const ACCEPTED = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

export type PreviewResult = {
  parsed: ParsedCatalog;
  fileName: string;
  errorReport: string;
};

/**
 * Paso 1: previsualizar y validar. No escribe nada.
 */
export async function previewCatalogImport(
  formData: FormData,
): Promise<ActionResult<PreviewResult>> {
  const session = await requireSession();
  if (session.role !== 'owner') return fail('Solo el dueño puede importar el catálogo.');

  const file = formData.get('archivo');
  if (!(file instanceof File) || file.size === 0) {
    return fail('Elegí un archivo XLSX para importar.');
  }
  if (file.size > MAX_BYTES) {
    return fail('El archivo supera los 8 MB.');
  }
  if (file.type && !ACCEPTED.has(file.type) && !file.name.toLowerCase().endsWith('.xlsx')) {
    return fail('El archivo debe ser un XLSX.');
  }

  const supabase = await createClient();
  const { data: existing } = await supabase.from('product_variants').select('sku');
  const existingSkus = new Set((existing ?? []).map((v) => v.sku as string));

  try {
    const parsed = await parseCatalogWorkbook(await file.arrayBuffer(), { existingSkus });
    return ok({ parsed, fileName: file.name, errorReport: buildErrorReport(parsed) });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : 'No se pudo leer el archivo. ¿Es un XLSX válido?',
    );
  }
}

const applySchema = z.object({
  fileName: z.string().max(200).optional(),
  rows: z
    .array(
      z.object({
        fila: z.number().int(),
        nombre: z.string().min(1),
        categoria: z.string().nullable(),
        variante: z.string(),
        atributos: z.record(z.string(), z.string()),
        sku: z.string().nullable(),
        codigo_barras: z.string().nullable(),
        proveedor: z.string().nullable(),
        costo: z.string().nullable(),
        precio_lista: z.string().nullable(),
        precio_transferencia: z.string().nullable(),
        precio_mayorista: z.string().nullable(),
        stock_salon: z.number().nonnegative(),
        stock_altillo: z.number().nonnegative(),
        stock_minimo: z.number().nonnegative(),
        tipo: z.enum(['simple', 'variant', 'service', 'bundle_virtual', 'bundle_stocked']),
        activo: z.boolean(),
      }),
    )
    .min(1, 'No hay filas válidas para importar'),
  bundles: z
    .array(
      z.object({
        fila: z.number().int(),
        sku_combo: z.string().min(1),
        sku_componente: z.string().min(1),
        cantidad: z.number().positive(),
      }),
    )
    .default([]),
});

/**
 * Paso 2: aplicar solo las filas válidas.
 *
 * Toda la escritura ocurre dentro de `apply_catalog_import`, que crea el
 * `import_job`, los productos, los precios con su historial y el stock inicial
 * como movimiento real, o no hace nada.
 */
export async function applyCatalogImport(
  input: z.input<typeof applySchema>,
): Promise<ActionResult<{ job_id: string; creadas: number; omitidas: number; componentes: number }>> {
  const session = await requireSession();
  if (session.role !== 'owner') return fail('Solo el dueño puede importar el catálogo.');

  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('apply_catalog_import', {
    p_rows: parsed.data.rows,
    p_bundles: parsed.data.bundles,
    p_file_name: parsed.data.fileName ?? null,
  });

  if (error) return fail(describeError(error));

  revalidatePath('/productos');
  revalidatePath('/stock');
  revalidatePath('/venta');
  return ok(data as { job_id: string; creadas: number; omitidas: number; componentes: number });
}

const revertSchema = z.object({
  job_id: z.string().uuid(),
  reason: z.string().min(3, 'Escribí el motivo de la reversión').max(300),
});

export async function revertCatalogImport(
  input: z.input<typeof revertSchema>,
): Promise<ActionResult<{ eliminadas: number }>> {
  const session = await requireSession();
  if (session.role !== 'owner') return fail('Solo el dueño puede revertir una importación.');

  const parsed = revertSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('revert_catalog_import', {
    p_job: parsed.data.job_id,
    p_reason: parsed.data.reason,
  });

  if (error) return fail(describeError(error));

  revalidatePath('/productos');
  revalidatePath('/stock');
  return ok(data as { eliminadas: number });
}
