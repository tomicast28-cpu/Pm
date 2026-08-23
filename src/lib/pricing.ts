/**
 * Resolución de precios en el cliente.
 *
 * Refleja `app.effective_price` y `app.round_price` de la base para que el
 * mostrador muestre el precio sin ida y vuelta al servidor. La base sigue
 * siendo la autoridad: al confirmar la venta ella recalcula, y si hubiera
 * discrepancia gana la base.
 */
import { Money } from './money';

export type PriceListRule = {
  id: string;
  code: string;
  name: string;
  derived_from_id: string | null;
  adjustment_rate: string;
  rounding: string;
  is_default: boolean;
  is_wholesale: boolean;
  sort_order: number;
};

export type VariantPriceRow = {
  variant_id: string;
  price_list_id: string;
  price: string;
  tax_rate: string;
};

export function roundPrice(value: Money, mode: string): Money {
  const cents = value.cents;
  const round = (unitCents: bigint) => {
    const half = unitCents / 2n;
    const remainder = ((cents % unitCents) + unitCents) % unitCents;
    const base = cents - remainder;
    return remainder >= half ? base + unitCents : base;
  };

  switch (mode) {
    case 'unit':
      return Money.fromCents(round(100n));
    case 'ten':
      return Money.fromCents(round(1000n));
    case 'hundred':
      return Money.fromCents(round(10000n));
    case 'five_hundred':
      return Money.fromCents(round(50000n));
    case 'ending_990': {
      // Valor terminado en 990 más cercano: 990, 1.990, 2.990, …
      const step = 100000n; // $1.000 en centavos
      const anchor = 99000n; // $990 en centavos
      const k = roundDivide(cents - anchor, step);
      const candidate = k * step + anchor;
      return Money.fromCents(candidate < anchor ? anchor : candidate);
    }
    case 'none':
    default:
      return value;
  }
}

function roundDivide(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

export function resolvePrice(
  variantId: string,
  priceListId: string,
  lists: PriceListRule[],
  prices: VariantPriceRow[],
  seen = new Set<string>(),
): Money | null {
  if (seen.has(priceListId)) return null; // corta una derivación circular
  seen.add(priceListId);

  const explicit = prices.find(
    (p) => p.variant_id === variantId && p.price_list_id === priceListId,
  );
  if (explicit) return Money.parse(explicit.price);

  const list = lists.find((l) => l.id === priceListId);
  if (!list?.derived_from_id) return null;

  const base = resolvePrice(variantId, list.derived_from_id, lists, prices, seen);
  if (!base) return null;

  const adjusted = base.add(base.rate(list.adjustment_rate));
  return roundPrice(adjusted, list.rounding);
}
