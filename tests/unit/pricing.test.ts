import { describe, expect, it } from 'vitest';
import { Money } from '@/lib/money';
import { resolvePrice, roundPrice, type PriceListRule, type VariantPriceRow } from '@/lib/pricing';

const lists: PriceListRule[] = [
  { id: 'lista', code: 'lista', name: 'Lista', derived_from_id: null, adjustment_rate: '0', rounding: 'none', is_default: true, is_wholesale: false, sort_order: 1 },
  { id: 'transf', code: 'transferencia', name: 'Transferencia', derived_from_id: 'lista', adjustment_rate: '-0.10', rounding: 'ten', is_default: false, is_wholesale: false, sort_order: 2 },
  { id: 'mayor', code: 'mayorista', name: 'Mayorista', derived_from_id: 'lista', adjustment_rate: '-0.25', rounding: 'ten', is_default: false, is_wholesale: true, sort_order: 3 },
  { id: 'circular', code: 'circular', name: 'Circular', derived_from_id: 'circular', adjustment_rate: '0', rounding: 'none', is_default: false, is_wholesale: false, sort_order: 4 },
];

const prices: VariantPriceRow[] = [
  { variant_id: 'v1', price_list_id: 'lista', price: '18500.00', tax_rate: '0.21' },
];

describe('roundPrice', () => {
  it('redondea a la decena', () => {
    expect(roundPrice(Money.parse('16650.00'), 'ten').toDecimalString()).toBe('16650.00');
    expect(roundPrice(Money.parse('16653.00'), 'ten').toDecimalString()).toBe('16650.00');
    expect(roundPrice(Money.parse('16656.00'), 'ten').toDecimalString()).toBe('16660.00');
  });

  it('redondea a la centena y al medio millar', () => {
    expect(roundPrice(Money.parse('16650.00'), 'hundred').toDecimalString()).toBe('16700.00');
    expect(roundPrice(Money.parse('16400.00'), 'five_hundred').toDecimalString()).toBe('16500.00');
  });

  it('redondea a terminación 990', () => {
    expect(roundPrice(Money.parse('2340.00'), 'ending_990').toDecimalString()).toBe('1990.00');
    expect(roundPrice(Money.parse('2600.00'), 'ending_990').toDecimalString()).toBe('2990.00');
    expect(roundPrice(Money.parse('500.00'), 'ending_990').toDecimalString()).toBe('990.00');
  });

  it('deja el valor intacto sin regla', () => {
    expect(roundPrice(Money.parse('16653.45'), 'none').toDecimalString()).toBe('16653.45');
  });
});

describe('resolvePrice', () => {
  it('devuelve el precio explícito de la lista', () => {
    expect(resolvePrice('v1', 'lista', lists, prices)?.toDecimalString()).toBe('18500.00');
  });

  it('deriva la lista de transferencia con su descuento y redondeo', () => {
    // 18.500 - 10% = 16.650, ya redondeado a la decena.
    expect(resolvePrice('v1', 'transf', lists, prices)?.toDecimalString()).toBe('16650.00');
  });

  it('deriva la lista mayorista', () => {
    // 18.500 - 25% = 13.875 -> 13.880 redondeando a la decena.
    expect(resolvePrice('v1', 'mayor', lists, prices)?.toDecimalString()).toBe('13880.00');
  });

  it('devuelve null si la variante no tiene precio', () => {
    expect(resolvePrice('desconocida', 'lista', lists, prices)).toBeNull();
  });

  it('no entra en bucle con una derivación circular', () => {
    expect(resolvePrice('v1', 'circular', lists, prices)).toBeNull();
  });
});
