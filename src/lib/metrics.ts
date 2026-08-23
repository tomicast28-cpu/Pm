/**
 * Indicadores del capítulo 22.5 de la especificación.
 *
 * Cuando no hay historia suficiente devuelven `null` en lugar de un número
 * inventado: la interfaz muestra «Datos insuficientes».
 */
import { Money } from '@/lib/money';

export function averageTicket(netSales: Money, salesCount: number): Money | null {
  if (salesCount <= 0) return null;
  return Money.fromCents(netSales.cents / BigInt(salesCount));
}

export function unitsPerTicket(netUnits: number, salesCount: number): number | null {
  if (salesCount <= 0) return null;
  return netUnits / salesCount;
}

export function sellThrough(unitsSold: number, initialStock: number, received: number): number | null {
  const denominator = initialStock + received;
  if (denominator <= 0) return null;
  return unitsSold / denominator;
}

export function turnover(costOfGoodsSold: Money, averageInventoryCost: Money): number | null {
  if (averageInventoryCost.isZero()) return null;
  return costOfGoodsSold.toNumber() / averageInventoryCost.toNumber();
}

export function coverageDays(available: number, averageDailyUnits: number): number | null {
  if (averageDailyUnits <= 0) return null;
  return available / averageDailyUnits;
}

export function gmroi(grossMargin: Money, averageInventoryCost: Money): number | null {
  if (averageInventoryCost.isZero()) return null;
  return grossMargin.toNumber() / averageInventoryCost.toNumber();
}

export function quoteConversion(confirmedOrders: number, quotesIssued: number): number | null {
  if (quotesIssued <= 0) return null;
  return confirmedOrders / quotesIssued;
}

export function overdueRate(overdueBalance: Money, totalReceivable: Money): number | null {
  if (totalReceivable.isZero()) return null;
  return overdueBalance.toNumber() / totalReceivable.toNumber();
}

export function cashDifference(declared: Money, expected: Money): Money {
  return declared.subtract(expected);
}

/** Envío absorbido: nunca negativo a los efectos del cálculo (9.5). */
export function absorbedShipping(actualCost: Money, chargedToCustomer: Money): Money {
  const difference = actualCost.subtract(chargedToCustomer);
  return difference.isNegative() ? Money.zero : difference;
}

export function directContribution(params: {
  netSales: Money;
  replacementCost: Money;
  commissions: Money;
  absorbedShipping: Money;
  otherDirectCosts: Money;
}): Money {
  return params.netSales
    .subtract(params.replacementCost)
    .subtract(params.commissions)
    .subtract(params.absorbedShipping)
    .subtract(params.otherDirectCosts);
}

export function contributionMargin(contribution: Money, netSales: Money): number | null {
  if (netSales.isZero()) return null;
  return contribution.toNumber() / netSales.toNumber();
}

/** Clasificación ABC/Pareto: A ≈ 80% del aporte, B el 15% siguiente, C el resto. */
export function classifyAbc(
  items: { id: string; value: number }[],
): { id: string; value: number; share: number; cumulative: number; abc: 'A' | 'B' | 'C' }[] {
  const total = items.reduce((sum, i) => sum + i.value, 0);
  if (total <= 0) return items.map((i) => ({ ...i, share: 0, cumulative: 0, abc: 'C' as const }));

  // Se acumulan los valores crudos y se comparan contra los umbrales del total.
  // Acumular porcentajes arrastra el error de la coma flotante y deja fuera de
  // la clase B a un producto que cae justo en el límite (0,80 + 0,15 > 0,95).
  const epsilon = total * 1e-9;
  let cumulativeValue = 0;

  return [...items]
    .sort((a, b) => b.value - a.value)
    .map((item) => {
      cumulativeValue += item.value;
      const abc: 'A' | 'B' | 'C' =
        cumulativeValue <= total * 0.8 + epsilon
          ? 'A'
          : cumulativeValue <= total * 0.95 + epsilon
            ? 'B'
            : 'C';
      return {
        ...item,
        share: item.value / total,
        cumulative: cumulativeValue / total,
        abc,
      };
    });
}

/**
 * Regla del 22.3: un ranking de «menos vendido» honesto excluye lo que nunca
 * tuvo oportunidad real de venderse.
 */
export type SlowMoverInput = {
  id: string;
  isActive: boolean;
  isService: boolean;
  daysSinceCreated: number;
  unitsSold: number;
  availableStock: number;
  isDiscontinued: boolean;
};

export type SlowMoverBucket =
  | 'sin_ventas'
  | 'baja_rotacion'
  | 'nuevo_sin_historial'
  | 'sin_stock'
  | 'discontinuado'
  | 'excluido';

export function classifySlowMover(
  item: SlowMoverInput,
  options: { minDaysSinceCreated?: number; lowRotationThreshold?: number } = {},
): SlowMoverBucket {
  const minDays = options.minDaysSinceCreated ?? 30;
  const lowThreshold = options.lowRotationThreshold ?? 3;

  if (!item.isActive || item.isService) return 'excluido';
  if (item.isDiscontinued) return 'discontinuado';
  if (item.daysSinceCreated < minDays) return 'nuevo_sin_historial';
  if (item.availableStock <= 0) return 'sin_stock';
  if (item.unitsSold === 0) return 'sin_ventas';
  if (item.unitsSold < lowThreshold) return 'baja_rotacion';
  return 'excluido';
}

/** Reglas de recomendación del 22.10, con sus umbrales configurables. */
export type StaleStockInput = {
  daysSinceLastSale: number;
  oldestStockAgeDays: number;
  coverageDays: number | null;
  marginRate: number | null;
};

export function stockRecommendation(
  item: StaleStockInput,
  options: {
    noSaleDays?: number;
    stockAgeDays?: number;
    maxCoverageDays?: number;
    minMarginRate?: number;
  } = {},
): 'considerar_oferta' | 'no_reponer' | 'revisar_precio' | 'sin_accion' {
  const noSaleDays = options.noSaleDays ?? 60;
  const stockAgeDays = options.stockAgeDays ?? 90;
  const maxCoverage = options.maxCoverageDays ?? 120;
  const minMargin = options.minMarginRate ?? 0.2;

  if (item.daysSinceLastSale >= noSaleDays && item.oldestStockAgeDays >= stockAgeDays) {
    return 'considerar_oferta';
  }
  if (item.coverageDays !== null && item.coverageDays > maxCoverage) return 'no_reponer';
  if (item.marginRate !== null && item.marginRate < minMargin) return 'revisar_precio';
  return 'sin_accion';
}
