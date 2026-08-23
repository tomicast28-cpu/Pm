/**
 * Importación de catálogo desde XLSX.
 *
 * El flujo tiene dos pasos deliberadamente separados (21.3):
 *   1. `parseCatalogWorkbook` lee y valida fila por fila, sin tocar la base.
 *   2. La acción de servidor aplica solo las filas válidas dentro de un
 *      `import_job`, que registra quién importó qué y permite revertir el lote.
 *
 * Nada se sobrescribe en silencio: si un SKU ya existe, la fila se marca como
 * duplicada y se informa; no se pisa el producto existente por decisión propia.
 */
import ExcelJS from 'exceljs';
import { Money } from '@/lib/money';

export type ImportRowStatus = 'valid' | 'error' | 'duplicate';

export type CatalogRowData = {
  nombre: string;
  categoria: string | null;
  variante: string;
  atributos: Record<string, string>;
  sku: string | null;
  codigoBarras: string | null;
  proveedor: string | null;
  costo: string | null;
  precioLista: string | null;
  precioTransferencia: string | null;
  precioMayorista: string | null;
  stockSalon: number;
  stockAltillo: number;
  stockMinimo: number;
  tipo: 'simple' | 'variant' | 'service' | 'bundle_virtual' | 'bundle_stocked';
  activo: boolean;
};

export type CatalogRow = {
  rowNumber: number;
  status: ImportRowStatus;
  errors: string[];
  data: CatalogRowData;
};

export type BundleRow = {
  rowNumber: number;
  status: ImportRowStatus;
  errors: string[];
  data: { skuCombo: string; skuComponente: string; cantidad: number };
};

export type ParsedCatalog = {
  products: CatalogRow[];
  bundles: BundleRow[];
  summary: { total: number; valid: number; errors: number; duplicates: number };
};

const TYPE_MAP: Record<string, CatalogRowData['tipo']> = {
  simple: 'simple',
  variante: 'variant',
  variant: 'variant',
  servicio: 'service',
  service: 'service',
  combo_virtual: 'bundle_virtual',
  'combo virtual': 'bundle_virtual',
  combo_prearmado: 'bundle_stocked',
  'combo prearmado': 'bundle_stocked',
};

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text).trim();
    if ('result' in value) return String(value.result ?? '').trim();
    if ('richText' in value) {
      return value.richText.map((part) => part.text).join('').trim();
    }
  }
  return String(value).trim();
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const pair of raw.split(';')) {
    const [key, ...rest] = pair.split('=');
    if (!key || rest.length === 0) continue;
    const name = key.trim();
    const value = rest.join('=').trim();
    if (name && value) attributes[name] = value;
  }
  return attributes;
}

function parseQuantity(raw: string, label: string, errors: string[]): number {
  if (raw === '') return 0;
  const value = Number(raw.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${label} debe ser un número mayor o igual a cero (se leyó «${raw}»)`);
    return 0;
  }
  return value;
}

function parseMoney(raw: string, label: string, errors: string[]): string | null {
  if (raw === '') return null;
  try {
    const money = Money.parse(raw);
    if (money.isNegative()) {
      errors.push(`${label} no puede ser negativo`);
      return null;
    }
    return money.toDecimalString();
  } catch {
    errors.push(`${label} no es un importe válido (se leyó «${raw}»)`);
    return null;
  }
}

/** Lee el archivo y valida. No escribe nada en la base. */
export async function parseCatalogWorkbook(
  buffer: ArrayBuffer,
  options: { existingSkus?: Set<string> } = {},
): Promise<ParsedCatalog> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const productSheet = workbook.getWorksheet('Productos') ?? workbook.worksheets[0];
  if (!productSheet) {
    throw new Error('El archivo no tiene ninguna hoja para leer.');
  }

  // El encabezado se ubica por nombre de columna, no por posición: el archivo
  // puede traer las columnas en otro orden sin romper la importación.
  const columnIndex = new Map<string, number>();
  productSheet.getRow(1).eachCell((cell, index) => {
    const name = cellText(cell.value).toLowerCase().replace(/\s+/g, '_');
    if (name) columnIndex.set(name, index);
  });

  const missing = ['nombre', 'precio_lista'].filter((c) => !columnIndex.has(c));
  if (missing.length > 0) {
    throw new Error(`Faltan columnas obligatorias en la hoja Productos: ${missing.join(', ')}`);
  }

  const read = (row: ExcelJS.Row, column: string): string => {
    const index = columnIndex.get(column);
    return index ? cellText(row.getCell(index).value) : '';
  };

  const seenSkus = new Set<string>();
  const products: CatalogRow[] = [];

  productSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const nombre = read(row, 'nombre');
    // Una fila totalmente vacía es el final útil de la planilla, no un error.
    if (nombre === '' && read(row, 'sku') === '' && read(row, 'precio_lista') === '') return;

    const errors: string[] = [];
    if (nombre === '') errors.push('El nombre es obligatorio');

    const tipoRaw = read(row, 'tipo').toLowerCase();
    const tipo = tipoRaw === '' ? 'simple' : TYPE_MAP[tipoRaw];
    if (!tipo) {
      errors.push(
        `Tipo desconocido «${tipoRaw}». Valores válidos: simple, variante, servicio, combo_virtual, combo_prearmado`,
      );
    }

    const sku = read(row, 'sku') || null;
    let status: ImportRowStatus = 'valid';
    if (sku) {
      if (seenSkus.has(sku)) {
        errors.push(`El SKU ${sku} aparece más de una vez en el archivo`);
      } else if (options.existingSkus?.has(sku)) {
        // No es un error: es una decisión que le corresponde a la persona.
        status = 'duplicate';
      }
      seenSkus.add(sku);
    }

    const precioLista = parseMoney(read(row, 'precio_lista'), 'El precio de lista', errors);
    if (!precioLista && tipo !== 'bundle_virtual') {
      errors.push('Falta el precio de lista');
    }

    const data: CatalogRowData = {
      nombre,
      categoria: read(row, 'categoria') || null,
      variante: read(row, 'variante'),
      atributos: parseAttributes(read(row, 'atributos')),
      sku,
      codigoBarras: read(row, 'codigo_barras') || null,
      proveedor: read(row, 'proveedor') || null,
      costo: parseMoney(read(row, 'costo'), 'El costo', errors),
      precioLista,
      precioTransferencia: parseMoney(
        read(row, 'precio_transferencia'),
        'El precio de transferencia',
        errors,
      ),
      precioMayorista: parseMoney(read(row, 'precio_mayorista'), 'El precio mayorista', errors),
      stockSalon: parseQuantity(read(row, 'stock_salon'), 'El stock de Salón', errors),
      stockAltillo: parseQuantity(read(row, 'stock_altillo'), 'El stock de Altillo', errors),
      stockMinimo: parseQuantity(read(row, 'stock_minimo'), 'El stock mínimo', errors),
      tipo: tipo ?? 'simple',
      activo: read(row, 'activo').toLowerCase() !== 'no',
    };

    // Un servicio no lleva stock: avisar es mejor que ingresarlo en silencio.
    if (data.tipo === 'service' && (data.stockSalon > 0 || data.stockAltillo > 0)) {
      errors.push('Un servicio no lleva stock: dejá las columnas de stock vacías');
    }

    products.push({
      rowNumber,
      status: errors.length > 0 ? 'error' : status,
      errors,
      data,
    });
  });

  // ---------------------------------------------------------------------------
  // Hoja de combos
  // ---------------------------------------------------------------------------
  const bundles: BundleRow[] = [];
  const bundleSheet = workbook.getWorksheet('Combos');

  if (bundleSheet) {
    const declaredBundles = new Set(
      products
        .filter((p) => p.data.tipo === 'bundle_virtual' || p.data.tipo === 'bundle_stocked')
        .map((p) => p.data.sku)
        .filter((s): s is string => Boolean(s)),
    );

    bundleSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const skuCombo = cellText(row.getCell(1).value);
      const skuComponente = cellText(row.getCell(2).value);
      const cantidadRaw = cellText(row.getCell(3).value);
      if (!skuCombo && !skuComponente) return;

      const errors: string[] = [];
      if (!skuCombo) errors.push('Falta el SKU del combo');
      if (!skuComponente) errors.push('Falta el SKU del componente');
      if (skuCombo && skuComponente && skuCombo === skuComponente) {
        errors.push('Un combo no puede contenerse a sí mismo');
      }
      if (skuCombo && !declaredBundles.has(skuCombo) && !options.existingSkus?.has(skuCombo)) {
        errors.push(`El SKU ${skuCombo} no está declarado como combo en la hoja Productos`);
      }

      const cantidad = Number(cantidadRaw.replace(',', '.')) || 0;
      if (cantidad <= 0) errors.push('La cantidad debe ser mayor a cero');

      bundles.push({
        rowNumber,
        status: errors.length > 0 ? 'error' : 'valid',
        errors,
        data: { skuCombo, skuComponente, cantidad },
      });
    });
  }

  const all = [...products, ...bundles];
  return {
    products,
    bundles,
    summary: {
      total: all.length,
      valid: all.filter((r) => r.status === 'valid').length,
      errors: all.filter((r) => r.status === 'error').length,
      duplicates: all.filter((r) => r.status === 'duplicate').length,
    },
  };
}

/** CSV de errores que se descarga desde la previsualización. */
export function buildErrorReport(parsed: ParsedCatalog): string {
  const escape = (text: string) => `"${text.replace(/"/g, '""')}"`;
  const lines = ['hoja,fila,sku,estado,errores'];

  for (const row of parsed.products) {
    if (row.status === 'valid') continue;
    lines.push(
      [
        'Productos',
        String(row.rowNumber),
        escape(row.data.sku ?? ''),
        row.status === 'duplicate' ? 'SKU ya existente' : 'error',
        escape(row.errors.join(' · ') || 'El SKU ya existe en el catálogo'),
      ].join(','),
    );
  }

  for (const row of parsed.bundles) {
    if (row.status === 'valid') continue;
    lines.push(
      [
        'Combos',
        String(row.rowNumber),
        escape(row.data.skuCombo),
        'error',
        escape(row.errors.join(' · ')),
      ].join(','),
    );
  }

  return lines.join('\n');
}
