import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildErrorReport, parseCatalogWorkbook } from '@/server/import/catalog';

const HEADERS = [
  'nombre', 'categoria', 'variante', 'atributos', 'sku', 'codigo_barras', 'proveedor',
  'costo', 'precio_lista', 'precio_transferencia', 'precio_mayorista',
  'stock_salon', 'stock_altillo', 'stock_minimo', 'tipo', 'activo',
];

async function makeWorkbook(
  rows: (string | number | null)[][],
  bundles?: (string | number)[][],
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Productos');
  sheet.addRow(HEADERS);
  rows.forEach((row) => sheet.addRow(row));

  if (bundles) {
    const bundleSheet = workbook.addWorksheet('Combos');
    bundleSheet.addRow(['sku_combo', 'sku_componente', 'cantidad']);
    bundles.forEach((row) => bundleSheet.addRow(row));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

const validRow = [
  'Canasto', 'Canastos', 'Negro', 'color=Negro;medida=30x20', 'X-1', '', 'Maderas',
  '9200', '18500', '', '', 8, 12, 3, 'simple', 'si',
];

describe('lectura de la planilla', () => {
  it('lee una fila válida completa', async () => {
    const parsed = await parseCatalogWorkbook(await makeWorkbook([validRow]));
    expect(parsed.summary).toMatchObject({ valid: 1, errors: 0 });

    const row = parsed.products[0]!;
    expect(row.status).toBe('valid');
    expect(row.data.nombre).toBe('Canasto');
    expect(row.data.sku).toBe('X-1');
    expect(row.data.atributos).toEqual({ color: 'Negro', medida: '30x20' });
    expect(row.data.costo).toBe('9200.00');
    expect(row.data.precioLista).toBe('18500.00');
    expect(row.data.stockSalon).toBe(8);
    expect(row.data.stockAltillo).toBe(12);
    expect(row.data.activo).toBe(true);
  });

  it('ignora las filas vacías del final', async () => {
    const parsed = await parseCatalogWorkbook(
      await makeWorkbook([validRow, ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']]),
    );
    expect(parsed.products).toHaveLength(1);
  });

  it('acepta las columnas en otro orden', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Productos');
    sheet.addRow(['precio_lista', 'nombre', 'sku']);
    sheet.addRow(['12500', 'Tabla', 'T-1']);
    const parsed = await parseCatalogWorkbook((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
    expect(parsed.products[0]?.data).toMatchObject({ nombre: 'Tabla', precioLista: '12500.00' });
  });

  it('rechaza el archivo si falta una columna obligatoria', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Productos');
    sheet.addRow(['sku', 'variante']);
    sheet.addRow(['X-1', 'Negro']);
    await expect(
      parseCatalogWorkbook((await workbook.xlsx.writeBuffer()) as ArrayBuffer),
    ).rejects.toThrow(/Faltan columnas obligatorias/);
  });
});

describe('validación fila por fila', () => {
  it('marca la fila sin nombre', async () => {
    const row = [...validRow];
    row[0] = '';
    const parsed = await parseCatalogWorkbook(await makeWorkbook([row]));
    expect(parsed.products[0]?.status).toBe('error');
    expect(parsed.products[0]?.errors.join()).toContain('nombre es obligatorio');
  });

  it('marca un importe que no se puede leer', async () => {
    const row = [...validRow];
    row[8] = 'mil quinientos';
    const parsed = await parseCatalogWorkbook(await makeWorkbook([row]));
    expect(parsed.products[0]?.errors.join()).toContain('no es un importe válido');
  });

  it('marca un tipo desconocido', async () => {
    const row = [...validRow];
    row[14] = 'combo raro';
    const parsed = await parseCatalogWorkbook(await makeWorkbook([row]));
    expect(parsed.products[0]?.errors.join()).toContain('Tipo desconocido');
  });

  it('avisa si un servicio trae stock', async () => {
    const row = [...validRow];
    row[14] = 'servicio';
    const parsed = await parseCatalogWorkbook(await makeWorkbook([row]));
    expect(parsed.products[0]?.errors.join()).toContain('Un servicio no lleva stock');
  });

  it('marca el SKU repetido dentro del mismo archivo', async () => {
    const parsed = await parseCatalogWorkbook(await makeWorkbook([validRow, [...validRow]]));
    expect(parsed.products[1]?.errors.join()).toContain('aparece más de una vez');
  });

  it('marca como duplicado —no como error— un SKU que ya existe', async () => {
    const parsed = await parseCatalogWorkbook(await makeWorkbook([validRow]), {
      existingSkus: new Set(['X-1']),
    });
    // Duplicado significa «no se sobrescribe»: es una decisión, no un error.
    expect(parsed.products[0]?.status).toBe('duplicate');
    expect(parsed.products[0]?.errors).toHaveLength(0);
    expect(parsed.summary.duplicates).toBe(1);
    expect(parsed.summary.errors).toBe(0);
  });

  it('rechaza cantidades negativas', async () => {
    const row = [...validRow];
    row[11] = -5;
    const parsed = await parseCatalogWorkbook(await makeWorkbook([row]));
    expect(parsed.products[0]?.errors.join()).toContain('mayor o igual a cero');
  });
});

describe('hoja de combos', () => {
  const comboRow = [
    'Combo', 'Combos', 'Combo', '', 'C-1', '', '', '', '36000', '', '', '', '', '',
    'combo_virtual', 'si',
  ];

  it('lee los componentes de un combo declarado', async () => {
    const parsed = await parseCatalogWorkbook(
      await makeWorkbook([validRow, comboRow], [['C-1', 'X-1', 2]]),
    );
    expect(parsed.bundles[0]?.status).toBe('valid');
    expect(parsed.bundles[0]?.data).toEqual({
      skuCombo: 'C-1',
      skuComponente: 'X-1',
      cantidad: 2,
    });
  });

  it('rechaza un combo que se contiene a sí mismo', async () => {
    const parsed = await parseCatalogWorkbook(
      await makeWorkbook([comboRow], [['C-1', 'C-1', 1]]),
    );
    expect(parsed.bundles[0]?.errors.join()).toContain('no puede contenerse a sí mismo');
  });

  it('rechaza componentes de un SKU no declarado como combo', async () => {
    const parsed = await parseCatalogWorkbook(
      await makeWorkbook([validRow], [['NO-EXISTE', 'X-1', 1]]),
    );
    expect(parsed.bundles[0]?.errors.join()).toContain('no está declarado como combo');
  });

  it('rechaza cantidad cero', async () => {
    const parsed = await parseCatalogWorkbook(
      await makeWorkbook([comboRow], [['C-1', 'X-1', 0]]),
    );
    expect(parsed.bundles[0]?.errors.join()).toContain('mayor a cero');
  });
});

describe('reporte de errores', () => {
  it('lista solo las filas con problema y escapa las comillas', async () => {
    const bad = [...validRow];
    bad[0] = '';
    bad[8] = 'no es un precio';
    const parsed = await parseCatalogWorkbook(await makeWorkbook([validRow, bad]));
    const report = buildErrorReport(parsed);

    const lines = report.split('\n');
    expect(lines[0]).toBe('hoja,fila,sku,estado,errores');
    expect(lines).toHaveLength(2); // encabezado + una fila con problema
    expect(lines[1]).toContain('Productos');
    expect(lines[1]).toContain('nombre es obligatorio');
  });

  it('incluye los duplicados con su explicación', async () => {
    const parsed = await parseCatalogWorkbook(await makeWorkbook([validRow]), {
      existingSkus: new Set(['X-1']),
    });
    expect(buildErrorReport(parsed)).toContain('SKU ya existente');
  });
});
