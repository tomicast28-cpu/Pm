import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/server/session';
import { buildWorkbook, toDate, toNumber, type ExportColumn } from '@/server/export/workbook';

/**
 * Exportación a XLSX.
 *
 * Las consultas se hacen con la sesión del usuario, así que la RLS decide qué
 * filas salen: una exportación no puede convertirse en la puerta trasera por la
 * que el empleado se lleva los costos. Las exportaciones que son íntegramente
 * confidenciales se rechazan antes, para dar un error claro en vez de un
 * archivo vacío.
 */

type ExportDefinition = {
  sheet: string;
  fileName: string;
  title: string;
  ownerOnly?: boolean;
  columns: ExportColumn[];
  load: (
    supabase: Awaited<ReturnType<typeof createClient>>,
  ) => Promise<Record<string, unknown>[]>;
};

const EXPORTS: Record<string, ExportDefinition> = {
  catalogo: {
    sheet: 'Catálogo',
    fileName: 'catalogo',
    title: 'Catálogo de productos',
    columns: [
      { header: 'SKU', key: 'sku', width: 14 },
      { header: 'Producto', key: 'product_name', width: 32 },
      { header: 'Variante', key: 'variant_name', width: 22 },
      { header: 'Tipo', key: 'kind', width: 16 },
      { header: 'Categoría', key: 'category_name', width: 18 },
      { header: 'Marca', key: 'brand', width: 16 },
      { header: 'Unidad', key: 'unit', width: 10 },
      { header: 'Stock mínimo', key: 'min_stock', width: 13 },
      { header: 'Disponible', key: 'available_qty', width: 12 },
      { header: 'Físico', key: 'on_hand_qty', width: 12 },
      { header: 'Reservado', key: 'reserved_qty', width: 12 },
      { header: 'Activo', key: 'is_active', width: 9 },
    ],
    async load(supabase) {
      const { data } = await supabase.from('v_pos_catalog').select('*').order('product_name');
      return (data ?? []).map((row) => ({
        ...row,
        kind: KIND_LABELS[row.kind as string] ?? row.kind,
        min_stock: toNumber(row.min_stock),
        available_qty: toNumber(row.available_qty),
        on_hand_qty: toNumber(row.on_hand_qty),
        reserved_qty: toNumber(row.reserved_qty),
        is_active: row.is_active ? 'sí' : 'no',
      }));
    },
  },

  stock: {
    sheet: 'Stock',
    fileName: 'stock',
    title: 'Stock por ubicación',
    columns: [
      { header: 'SKU', key: 'sku', width: 14 },
      { header: 'Producto', key: 'display_name', width: 36 },
      { header: 'Ubicación', key: 'location_name', width: 14 },
      { header: 'Físico', key: 'on_hand', width: 11 },
      { header: 'Reservado', key: 'reserved', width: 11 },
      { header: 'Disponible', key: 'available', width: 11 },
      { header: 'Mínimo', key: 'min_stock', width: 10 },
      { header: 'Bajo mínimo', key: 'below_minimum', width: 12 },
    ],
    async load(supabase) {
      const { data } = await supabase
        .from('v_stock_by_location')
        .select('*')
        .eq('state', 'available')
        .order('display_name');
      return (data ?? []).map((row) => ({
        ...row,
        on_hand: toNumber(row.on_hand),
        reserved: toNumber(row.reserved),
        available: toNumber(row.available),
        min_stock: toNumber(row.min_stock),
        below_minimum: row.below_minimum ? 'sí' : 'no',
      }));
    },
  },

  movimientos: {
    sheet: 'Movimientos',
    fileName: 'movimientos-stock',
    title: 'Movimientos de stock',
    columns: [
      { header: 'Fecha', key: 'created_at', width: 18 },
      { header: 'Tipo', key: 'movement_type', width: 24 },
      { header: 'Referencia', key: 'reference_type', width: 16 },
      { header: 'Motivo', key: 'reason', width: 40 },
    ],
    async load(supabase) {
      const { data } = await supabase
        .from('inventory_movements')
        .select('created_at, movement_type, reference_type, reason')
        .order('created_at', { ascending: false })
        .limit(5000);
      return (data ?? []).map((row) => ({
        ...row,
        created_at: toDate(row.created_at),
        movement_type: MOVEMENT_LABELS[row.movement_type as string] ?? row.movement_type,
      }));
    },
  },

  ventas: {
    sheet: 'Ventas',
    fileName: 'ventas',
    title: 'Ventas registradas',
    columns: [
      { header: 'Número', key: 'number', width: 14 },
      { header: 'Fecha', key: 'created_at', width: 18 },
      { header: 'Estado', key: 'status', width: 14 },
      { header: 'Pago', key: 'payment_status', width: 12 },
      { header: 'Subtotal', key: 'subtotal', width: 14 },
      { header: 'Descuentos', key: 'discount_total', width: 14 },
      { header: 'Envío', key: 'shipping_total', width: 12 },
      { header: 'Total', key: 'total', width: 14 },
      { header: 'Cobrado', key: 'paid_total', width: 14 },
      { header: 'Saldo', key: 'balance_due', width: 14 },
    ],
    async load(supabase) {
      const { data } = await supabase
        .from('orders')
        .select(
          'number, created_at, status, payment_status, subtotal, discount_total, shipping_total, total, paid_total, balance_due',
        )
        .eq('kind', 'sale')
        .order('created_at', { ascending: false })
        .limit(5000);
      return (data ?? []).map((row) => ({
        ...row,
        created_at: toDate(row.created_at),
        subtotal: toNumber(row.subtotal),
        discount_total: toNumber(row.discount_total),
        shipping_total: toNumber(row.shipping_total),
        total: toNumber(row.total),
        paid_total: toNumber(row.paid_total),
        balance_due: toNumber(row.balance_due),
      }));
    },
  },

  caja: {
    sheet: 'Caja',
    fileName: 'sesiones-de-caja',
    title: 'Sesiones de caja',
    columns: [
      { header: 'Número', key: 'number', width: 12 },
      { header: 'Apertura', key: 'opened_at', width: 18 },
      { header: 'Cierre', key: 'closed_at', width: 18 },
      { header: 'Estado', key: 'status', width: 10 },
      { header: 'Inicial', key: 'opening_amount', width: 14 },
      { header: 'Esperado', key: 'expected_cash', width: 14 },
      { header: 'Declarado', key: 'declared_cash', width: 14 },
      { header: 'Diferencia', key: 'cash_difference', width: 14 },
      { header: 'Reaperturas', key: 'reopened_count', width: 12 },
    ],
    async load(supabase) {
      const { data } = await supabase
        .from('cash_sessions')
        .select(
          'number, opened_at, closed_at, status, opening_amount, expected_cash, declared_cash, cash_difference, reopened_count',
        )
        .order('opened_at', { ascending: false })
        .limit(2000);
      return (data ?? []).map((row) => ({
        ...row,
        opened_at: toDate(row.opened_at),
        closed_at: toDate(row.closed_at),
        opening_amount: toNumber(row.opening_amount),
        expected_cash: toNumber(row.expected_cash),
        declared_cash: toNumber(row.declared_cash),
        cash_difference: toNumber(row.cash_difference),
      }));
    },
  },

  rentabilidad: {
    sheet: 'Rentabilidad',
    fileName: 'rentabilidad',
    title: 'Rentabilidad por línea vendida',
    ownerOnly: true,
    columns: [
      { header: 'Venta', key: 'number', width: 14 },
      { header: 'Fecha', key: 'created_at', width: 18 },
      { header: 'SKU', key: 'sku_snapshot', width: 14 },
      { header: 'Producto', key: 'name_snapshot', width: 34 },
      { header: 'Cantidad', key: 'quantity', width: 10 },
      { header: 'Venta neta', key: 'net_revenue', width: 14 },
      { header: 'Costo reposición', key: 'replacement_cost', width: 16 },
      { header: 'Costo promedio', key: 'average_cost', width: 15 },
      { header: 'Costo FIFO', key: 'fifo_cost', width: 14 },
      { header: 'Comisión imputada', key: 'allocated_commission', width: 17 },
      { header: 'Contribución directa', key: 'direct_contribution', width: 19 },
    ],
    async load(supabase) {
      const { data } = await supabase
        .from('v_sale_margins')
        .select('*')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(5000);
      return (data ?? []).map((row) => ({
        ...row,
        created_at: toDate(row.created_at),
        quantity: toNumber(row.quantity),
        net_revenue: toNumber(row.net_revenue),
        replacement_cost: toNumber(row.replacement_cost),
        average_cost: toNumber(row.average_cost),
        fifo_cost: toNumber(row.fifo_cost),
        allocated_commission: toNumber(row.allocated_commission),
        direct_contribution: toNumber(row.direct_contribution),
      }));
    },
  },
};

const KIND_LABELS: Record<string, string> = {
  simple: 'Simple',
  variant: 'Con variantes',
  service: 'Servicio',
  bundle_virtual: 'Combo virtual',
  bundle_stocked: 'Combo prearmado',
};

const MOVEMENT_LABELS: Record<string, string> = {
  purchase_receipt: 'Ingreso por compra',
  sale: 'Venta',
  reservation: 'Reserva',
  reservation_release: 'Liberación de reserva',
  fulfillment: 'Entrega',
  online_sale_exit: 'Salida por venta online',
  transfer: 'Transferencia',
  adjustment_in: 'Ajuste positivo',
  adjustment_out: 'Ajuste negativo',
  damage: 'Daño',
  damage_recovery: 'Recuperación de daño',
  customer_return: 'Devolución de cliente',
  supplier_return: 'Devolución a proveedor',
  bundle_assemble: 'Armado de combo',
  bundle_disassemble: 'Desarmado de combo',
  initial_inventory: 'Inventario inicial',
  reversal: 'Reversión',
};

export async function GET(_request: Request, context: { params: Promise<{ tipo: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Necesitás iniciar sesión.' }, { status: 401 });
  }

  const { tipo } = await context.params;
  const definition = EXPORTS[tipo];
  if (!definition) {
    return NextResponse.json(
      { error: `No existe la exportación «${tipo}».`, disponibles: Object.keys(EXPORTS) },
      { status: 404 },
    );
  }

  if (definition.ownerOnly && session.role !== 'owner') {
    return NextResponse.json(
      { error: 'Esta exportación contiene costos y márgenes: solo la puede descargar el dueño.' },
      { status: 403 },
    );
  }

  const supabase = await createClient();
  const rows = await definition.load(supabase);

  const buffer = await buildWorkbook(definition.sheet, definition.columns, rows, {
    title: `${definition.title} · Punto Madera`,
    filters: `${rows.length} registros · generado el ${new Date().toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
    })}`,
  });

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${definition.fileName}-${date}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
