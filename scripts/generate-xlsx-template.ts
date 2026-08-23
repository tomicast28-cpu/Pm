/**
 * Genera la plantilla de importación de catálogo (21.2).
 *
 * Hoja «Productos»: una fila por variante.
 * Hoja «Combos»: componentes de cada combo.
 * Hoja «Instrucciones»: qué significa cada columna y qué se valida.
 *
 * Uso: npm run xlsx:template
 */
import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const OUTPUT = 'public/plantillas/plantilla-catalogo-punto-madera.xlsx';

type Column = { header: string; key: string; width: number; note: string };

const PRODUCT_COLUMNS: Column[] = [
  { header: 'nombre', key: 'nombre', width: 30, note: 'Obligatorio. Nombre del producto.' },
  { header: 'categoria', key: 'categoria', width: 18, note: 'Se crea si no existe.' },
  { header: 'variante', key: 'variante', width: 22, note: 'Ej.: «Negro 30x20x15». Vacío para producto simple.' },
  { header: 'atributos', key: 'atributos', width: 34, note: 'Pares clave=valor separados por «;». Ej.: color=Negro;medida=30x20x15' },
  { header: 'sku', key: 'sku', width: 14, note: 'Opcional. Si va vacío se genera automáticamente.' },
  { header: 'codigo_barras', key: 'codigo_barras', width: 16, note: 'Opcional.' },
  { header: 'proveedor', key: 'proveedor', width: 20, note: 'Opcional. Se crea si no existe.' },
  { header: 'costo', key: 'costo', width: 12, note: 'Con IVA incluido. Solo lo ve el dueño.' },
  { header: 'precio_lista', key: 'precio_lista', width: 14, note: 'Obligatorio salvo para combos virtuales con precio derivado.' },
  { header: 'precio_transferencia', key: 'precio_transferencia', width: 18, note: 'Opcional. Vacío = se deriva de la lista.' },
  { header: 'precio_mayorista', key: 'precio_mayorista', width: 16, note: 'Opcional. Vacío = se deriva de la lista.' },
  { header: 'stock_salon', key: 'stock_salon', width: 12, note: 'Cantidad inicial en Salón.' },
  { header: 'stock_altillo', key: 'stock_altillo', width: 13, note: 'Cantidad inicial en Altillo.' },
  { header: 'stock_minimo', key: 'stock_minimo', width: 12, note: 'Dispara la alerta de reposición.' },
  { header: 'tipo', key: 'tipo', width: 16, note: 'simple | variante | servicio | combo_virtual | combo_prearmado' },
  { header: 'activo', key: 'activo', width: 9, note: 'si | no' },
];

const BUNDLE_COLUMNS: Column[] = [
  { header: 'sku_combo', key: 'sku_combo', width: 16, note: 'SKU del combo definido en la hoja Productos.' },
  { header: 'sku_componente', key: 'sku_componente', width: 18, note: 'SKU de la pieza que lo integra.' },
  { header: 'cantidad', key: 'cantidad', width: 11, note: 'Unidades de esa pieza por combo.' },
];

const SAMPLE_PRODUCTS = [
  {
    nombre: 'Canasto de zuncho', categoria: 'Canastos', variante: 'Negro 30x20x15',
    atributos: 'color=Negro;medida=30x20x15;material=Zuncho', sku: 'PM-00001', codigo_barras: '',
    proveedor: 'Maderas del Sur', costo: 9200, precio_lista: 18500, precio_transferencia: '',
    precio_mayorista: '', stock_salon: 8, stock_altillo: 12, stock_minimo: 3,
    tipo: 'variante', activo: 'si',
  },
  {
    nombre: 'Canasto de zuncho', categoria: 'Canastos', variante: 'Blanco 30x20x15',
    atributos: 'color=Blanco;medida=30x20x15;material=Zuncho', sku: 'PM-00002', codigo_barras: '',
    proveedor: 'Maderas del Sur', costo: 9200, precio_lista: 18500, precio_transferencia: '',
    precio_mayorista: '', stock_salon: 5, stock_altillo: 0, stock_minimo: 3,
    tipo: 'variante', activo: 'si',
  },
  {
    nombre: 'Tabla de asado', categoria: 'Tablas', variante: '40x30',
    atributos: 'medida=40x30;material=Algarrobo', sku: 'PM-00003', codigo_barras: '',
    proveedor: 'Maderas del Sur', costo: 16400, precio_lista: 32000, precio_transferencia: '',
    precio_mayorista: '', stock_salon: 6, stock_altillo: 4, stock_minimo: 2,
    tipo: 'simple', activo: 'si',
  },
  {
    nombre: 'Pinza de parrilla', categoria: 'Parrilla', variante: 'Acero',
    atributos: 'material=Acero', sku: 'PM-00005', codigo_barras: '',
    proveedor: 'Maderas del Sur', costo: 3600, precio_lista: 7400, precio_transferencia: '',
    precio_mayorista: '', stock_salon: 9, stock_altillo: 0, stock_minimo: 2,
    tipo: 'simple', activo: 'si',
  },
  {
    nombre: 'Combo Asador', categoria: 'Combos', variante: 'Combo Asador', atributos: '',
    sku: 'PM-00006', codigo_barras: '', proveedor: '', costo: '', precio_lista: 36000,
    precio_transferencia: '', precio_mayorista: '', stock_salon: '', stock_altillo: '',
    stock_minimo: '', tipo: 'combo_virtual', activo: 'si',
  },
  {
    nombre: 'Grabado', categoria: 'Servicios', variante: 'Grabado láser', atributos: '',
    sku: 'PM-00008', codigo_barras: '', proveedor: '', costo: 1200, precio_lista: 4500,
    precio_transferencia: '', precio_mayorista: '', stock_salon: '', stock_altillo: '',
    stock_minimo: '', tipo: 'servicio', activo: 'si',
  },
];

const SAMPLE_BUNDLES = [
  { sku_combo: 'PM-00006', sku_componente: 'PM-00003', cantidad: 1 },
  { sku_combo: 'PM-00006', sku_componente: 'PM-00005', cantidad: 1 },
];

function styleHeader(sheet: ExcelJS.Worksheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7A4B2A' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Punto Madera';
  workbook.created = new Date();

  const products = workbook.addWorksheet('Productos');
  products.columns = PRODUCT_COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  SAMPLE_PRODUCTS.forEach((row) => products.addRow(row));
  styleHeader(products);

  // La validación real ocurre al importar; esto evita errores obvios de tipeo.
  const tipoColumn = PRODUCT_COLUMNS.findIndex((c) => c.key === 'tipo') + 1;
  const activoColumn = PRODUCT_COLUMNS.findIndex((c) => c.key === 'activo') + 1;
  for (let row = 2; row <= 500; row += 1) {
    products.getCell(row, tipoColumn).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"simple,variante,servicio,combo_virtual,combo_prearmado"'],
    };
    products.getCell(row, activoColumn).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"si,no"'],
    };
  }

  const bundles = workbook.addWorksheet('Combos');
  bundles.columns = BUNDLE_COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  SAMPLE_BUNDLES.forEach((row) => bundles.addRow(row));
  styleHeader(bundles);

  const help = workbook.addWorksheet('Instrucciones');
  help.columns = [
    { header: 'Hoja', key: 'hoja', width: 14 },
    { header: 'Columna', key: 'columna', width: 24 },
    { header: 'Qué significa', key: 'nota', width: 82 },
  ];
  PRODUCT_COLUMNS.forEach((c) => help.addRow({ hoja: 'Productos', columna: c.header, nota: c.note }));
  BUNDLE_COLUMNS.forEach((c) => help.addRow({ hoja: 'Combos', columna: c.header, nota: c.note }));
  help.addRow({});
  help.addRow({
    hoja: 'General',
    columna: 'Importación',
    nota: 'La importación previsualiza, valida fila por fila y permite descargar los errores. Nada se sobrescribe en silencio.',
  });
  help.addRow({
    hoja: 'General',
    columna: 'Costos',
    nota: 'Los costos se cargan con IVA incluido y solo son visibles para el dueño.',
  });
  help.addRow({
    hoja: 'General',
    columna: 'Stock inicial',
    nota: 'El stock inicial genera un movimiento de inventario real, no una escritura directa de saldos.',
  });
  styleHeader(help);
  help.getColumn('nota').alignment = { wrapText: true, vertical: 'top' };

  await mkdir(dirname(OUTPUT), { recursive: true });
  await workbook.xlsx.writeFile(OUTPUT);
  console.log(`Plantilla generada en ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
