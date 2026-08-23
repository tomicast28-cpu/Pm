import { describe, expect, it } from 'vitest';
import { Money } from '@/lib/money';
import {
  absorbedShipping,
  averageTicket,
  cashDifference,
  classifyAbc,
  classifySlowMover,
  contributionMargin,
  coverageDays,
  directContribution,
  gmroi,
  overdueRate,
  quoteConversion,
  sellThrough,
  stockRecommendation,
  turnover,
  unitsPerTicket,
} from '@/lib/metrics';

describe('indicadores básicos', () => {
  it('calcula el ticket promedio', () => {
    expect(averageTicket(Money.parse('100000.00'), 4)?.toDecimalString()).toBe('25000.00');
  });

  it('devuelve null en lugar de inventar cuando no hay ventas', () => {
    expect(averageTicket(Money.parse('0.00'), 0)).toBeNull();
    expect(unitsPerTicket(0, 0)).toBeNull();
    expect(sellThrough(0, 0, 0)).toBeNull();
    expect(turnover(Money.parse('100.00'), Money.zero)).toBeNull();
    expect(coverageDays(10, 0)).toBeNull();
    expect(gmroi(Money.parse('100.00'), Money.zero)).toBeNull();
    expect(quoteConversion(0, 0)).toBeNull();
    expect(overdueRate(Money.parse('100.00'), Money.zero)).toBeNull();
  });

  it('calcula sell-through, rotación, cobertura y GMROI', () => {
    expect(sellThrough(30, 20, 30)).toBeCloseTo(0.6);
    expect(turnover(Money.parse('120000.00'), Money.parse('40000.00'))).toBeCloseTo(3);
    expect(coverageDays(90, 3)).toBe(30);
    expect(gmroi(Money.parse('80000.00'), Money.parse('40000.00'))).toBeCloseTo(2);
  });

  it('calcula la diferencia de caja como declarado menos esperado', () => {
    expect(
      cashDifference(Money.parse('19500.00'), Money.parse('20000.00')).toDecimalString(),
    ).toBe('-500.00');
  });
});

describe('rentabilidad', () => {
  it('el envío absorbido nunca es negativo', () => {
    // Se cobró más de lo que costó: no hay absorción.
    expect(absorbedShipping(Money.parse('5000.00'), Money.parse('6000.00')).toDecimalString()).toBe(
      '0.00',
    );
    expect(absorbedShipping(Money.parse('8000.00'), Money.parse('6000.00')).toDecimalString()).toBe(
      '2000.00',
    );
  });

  it('calcula la contribución directa y su margen', () => {
    const contribution = directContribution({
      netSales: Money.parse('18500.00'),
      replacementCost: Money.parse('9200.00'),
      commissions: Money.parse('153.00'),
      absorbedShipping: Money.parse('0.00'),
      otherDirectCosts: Money.parse('0.00'),
    });
    expect(contribution.toDecimalString()).toBe('9147.00');
    expect(contributionMargin(contribution, Money.parse('18500.00'))).toBeCloseTo(0.4944, 3);
  });

  it('una contribución negativa se refleja como tal', () => {
    const contribution = directContribution({
      netSales: Money.parse('9000.00'),
      replacementCost: Money.parse('9200.00'),
      commissions: Money.parse('100.00'),
      absorbedShipping: Money.parse('500.00'),
      otherDirectCosts: Money.zero,
    });
    expect(contribution.isNegative()).toBe(true);
  });
});

describe('ABC/Pareto', () => {
  it('clasifica por aporte acumulado', () => {
    const result = classifyAbc([
      { id: 'a', value: 800 },
      { id: 'b', value: 150 },
      { id: 'c', value: 50 },
    ]);
    expect(result[0]).toMatchObject({ id: 'a', abc: 'A' });
    expect(result[1]).toMatchObject({ id: 'b', abc: 'B' });
    expect(result[2]).toMatchObject({ id: 'c', abc: 'C' });
  });

  it('no revienta con total cero', () => {
    const result = classifyAbc([{ id: 'a', value: 0 }]);
    expect(result[0]?.abc).toBe('C');
  });
});

describe('regla del «menos vendido» (22.3)', () => {
  const base = {
    id: 'x',
    isActive: true,
    isService: false,
    daysSinceCreated: 120,
    unitsSold: 0,
    availableStock: 10,
    isDiscontinued: false,
  };

  it('no mezcla productos nuevos en el ranking', () => {
    expect(classifySlowMover({ ...base, daysSinceCreated: 10 })).toBe('nuevo_sin_historial');
  });

  it('no culpa al producto que no tuvo stock', () => {
    expect(classifySlowMover({ ...base, availableStock: 0 })).toBe('sin_stock');
  });

  it('separa sin ventas de baja rotación', () => {
    expect(classifySlowMover(base)).toBe('sin_ventas');
    expect(classifySlowMover({ ...base, unitsSold: 2 })).toBe('baja_rotacion');
  });

  it('excluye servicios e inactivos', () => {
    expect(classifySlowMover({ ...base, isService: true })).toBe('excluido');
    expect(classifySlowMover({ ...base, isActive: false })).toBe('excluido');
  });

  it('marca los discontinuados aparte', () => {
    expect(classifySlowMover({ ...base, isDiscontinued: true })).toBe('discontinuado');
  });

  it('un producto que rota bien no aparece', () => {
    expect(classifySlowMover({ ...base, unitsSold: 25 })).toBe('excluido');
  });
});

describe('recomendaciones de stock (22.10)', () => {
  it('sugiere oferta con 60 días sin venta y stock de más de 90', () => {
    expect(
      stockRecommendation({
        daysSinceLastSale: 70,
        oldestStockAgeDays: 120,
        coverageDays: 40,
        marginRate: 0.5,
      }),
    ).toBe('considerar_oferta');
  });

  it('sugiere no reponer con cobertura mayor a 120 días', () => {
    expect(
      stockRecommendation({
        daysSinceLastSale: 5,
        oldestStockAgeDays: 10,
        coverageDays: 200,
        marginRate: 0.5,
      }),
    ).toBe('no_reponer');
  });

  it('sugiere revisar precio si el margen está por debajo del mínimo', () => {
    expect(
      stockRecommendation({
        daysSinceLastSale: 5,
        oldestStockAgeDays: 10,
        coverageDays: 30,
        marginRate: 0.1,
      }),
    ).toBe('revisar_precio');
  });

  it('respeta umbrales configurados', () => {
    expect(
      stockRecommendation(
        { daysSinceLastSale: 40, oldestStockAgeDays: 50, coverageDays: 10, marginRate: 0.5 },
        { noSaleDays: 30, stockAgeDays: 45 },
      ),
    ).toBe('considerar_oferta');
  });

  it('no recomienda nada cuando todo está en orden', () => {
    expect(
      stockRecommendation({
        daysSinceLastSale: 3,
        oldestStockAgeDays: 20,
        coverageDays: 25,
        marginRate: 0.45,
      }),
    ).toBe('sin_accion');
  });
});
