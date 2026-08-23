import { describe, expect, it } from 'vitest';
import { Money } from '@/lib/money';

describe('Money.parse', () => {
  it('lee lo que devuelve la base', () => {
    expect(Money.parse('18500.00').toDecimalString()).toBe('18500.00');
    expect(Money.parse('0.05').cents).toBe(5n);
  });

  it('lee el formato es-AR escrito por una persona', () => {
    expect(Money.parse('18.500,50').toDecimalString()).toBe('18500.50');
    expect(Money.parse('$ 1.234,56').toDecimalString()).toBe('1234.56');
    expect(Money.parse('1234,5').toDecimalString()).toBe('1234.50');
  });

  it('trata vacío y nulo como cero', () => {
    expect(Money.parse('').isZero()).toBe(true);
    expect(Money.parse(null).isZero()).toBe(true);
    expect(Money.parse(undefined).isZero()).toBe(true);
  });

  it('maneja negativos', () => {
    expect(Money.parse('-500.25').toDecimalString()).toBe('-500.25');
    expect(Money.parse('-500.25').isNegative()).toBe(true);
  });

  it('redondea la tercera decimal', () => {
    expect(Money.parse('10.005').toDecimalString()).toBe('10.01');
    expect(Money.parse('10.004').toDecimalString()).toBe('10.00');
  });

  it('rechaza texto que no es un importe', () => {
    expect(() => Money.parse('mil pesos')).toThrow();
  });
});

describe('aritmética exacta', () => {
  it('no arrastra el error de la coma flotante', () => {
    // 0.1 + 0.2 === 0.30000000000000004 en punto flotante.
    const result = Money.parse('0.10').add(Money.parse('0.20'));
    expect(result.toDecimalString()).toBe('0.30');
    expect(result.equals(Money.parse('0.30'))).toBe(true);
  });

  it('suma cien veces un centavo sin desviarse', () => {
    let total = Money.zero;
    for (let i = 0; i < 100; i += 1) total = total.add(Money.parse('0.01'));
    expect(total.toDecimalString()).toBe('1.00');
  });

  it('multiplica por cantidades con decimales', () => {
    expect(Money.parse('32000.00').multiply(2).toDecimalString()).toBe('64000.00');
    expect(Money.parse('1000.00').multiply(1.5).toDecimalString()).toBe('1500.00');
    expect(Money.parse('333.33').multiply(3).toDecimalString()).toBe('999.99');
  });

  it('aplica tasas redondeando al centavo', () => {
    // Comisión de débito: 1,8% sobre 8.500 = 153,00
    expect(Money.parse('8500.00').rate('0.018').toDecimalString()).toBe('153.00');
    // Mercado Pago: 3,49% sobre 18.500 = 645,65
    expect(Money.parse('18500.00').rate('0.0349').toDecimalString()).toBe('645.65');
  });

  it('resta y compara', () => {
    const total = Money.parse('18500.00');
    const paid = Money.parse('10000.00').add(Money.parse('8500.00'));
    expect(total.subtract(paid).isZero()).toBe(true);
    expect(paid.compare(total)).toBe(0);
    expect(Money.parse('1.00').compare(Money.parse('2.00'))).toBe(-1);
  });

  it('suma una lista de importes', () => {
    const sum = Money.sum(['1000.10', '2000.20', '3000.30'].map(Money.parse));
    expect(sum.toDecimalString()).toBe('6000.60');
  });
});

describe('pago combinado', () => {
  it('un pago combinado cubre exactamente el total', () => {
    const total = Money.parse('18500.00');
    const payments = [Money.parse('10000.00'), Money.parse('8500.00')];
    expect(Money.sum(payments).equals(total)).toBe(true);
  });

  it('el vuelto es el excedente sobre el total', () => {
    const total = Money.parse('18500.00');
    const paid = Money.parse('20000.00');
    const remaining = total.subtract(paid);
    expect(remaining.isNegative()).toBe(true);
    expect(remaining.negate().toDecimalString()).toBe('1500.00');
  });
});
