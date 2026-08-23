import ExcelJS from 'exceljs';

/** Columnas de una exportación: encabezado en español y ancho razonable. */
export type ExportColumn = { header: string; key: string; width?: number };

/**
 * Arma un XLSX con el encabezado de la marca y el formato es-AR.
 *
 * Los importes van como número con formato de moneda —no como texto— para que
 * se puedan sumar en Excel; las fechas, como fecha real por el mismo motivo.
 */
export async function buildWorkbook(
  sheetName: string,
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
  meta?: { title?: string; filters?: string },
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Punto Madera';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: meta?.title ? 3 : 1 }],
  });

  if (meta?.title) {
    sheet.addRow([meta.title]);
    sheet.getRow(1).font = { bold: true, size: 13 };
    sheet.addRow([meta.filters ?? `Generado el ${new Date().toLocaleString('es-AR')}`]);
    sheet.getRow(2).font = { size: 9, color: { argb: 'FF7A7A7A' } };
    sheet.addRow([]);
  }

  const headerRowIndex = sheet.rowCount + 1;
  sheet.addRow(columns.map((c) => c.header));
  const header = sheet.getRow(headerRowIndex);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7A4B2A' } };
  header.height = 20;

  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width ?? 18;
  });

  for (const row of rows) {
    sheet.addRow(columns.map((c) => row[c.key] ?? null));
  }

  sheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}
