/**
 * Dinero exacto.
 *
 * Nunca se opera con `number` en coma flotante: 0.1 + 0.2 !== 0.3 y en una caja
 * eso termina en diferencias que nadie puede explicar. Internamente todo son
 * centavos enteros (`bigint`); a la base viaja como string decimal, que
 * PostgreSQL recibe en columnas `numeric`.
 */

const SCALE = 100n;

export class Money {
  private constructor(readonly cents: bigint) {}

  static readonly zero = new Money(0n);

  static fromCents(cents: bigint | number): Money {
    return new Money(typeof cents === 'bigint' ? cents : BigInt(Math.round(cents)));
  }

  /** Acepta lo que devuelve la base (`"18500.00"`) y lo que escribe una persona. */
  static parse(input: string | number | null | undefined): Money {
    if (input === null || input === undefined || input === '') return Money.zero;

    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error('Importe no válido');
      return new Money(BigInt(Math.round(input * 100)));
    }

    // Normaliza el formato es-AR: "18.500,50" -> "18500.50"
    let text = input.trim().replace(/\s/g, '').replace(/^\$/, '');
    if (text.includes(',')) {
      text = text.replace(/\./g, '').replace(',', '.');
    }

    const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
    if (!match) throw new Error(`Importe no válido: ${input}`);

    const sign = match[1] === '-' ? -1n : 1n;
    const whole = match[2] || '0';
    // Redondeo por mitad hacia arriba en la tercera decimal.
    const fracRaw = (match[3] || '').padEnd(3, '0');
    let cents = BigInt(whole) * SCALE + BigInt(fracRaw.slice(0, 2));
    if (Number(fracRaw[2] ?? '0') >= 5) cents += 1n;

    return new Money(sign * cents);
  }

  add(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  subtract(other: Money): Money {
    return new Money(this.cents - other.cents);
  }

  /** Multiplica por una cantidad que puede tener hasta 3 decimales. */
  multiply(quantity: number | string): Money {
    const milli = BigInt(Math.round(Number(quantity) * 1000));
    const product = this.cents * milli;
    return new Money(divideRounded(product, 1000n));
  }

  /** Aplica una tasa (0.21 = 21%) redondeando a centavo. */
  rate(rate: number | string): Money {
    const micro = BigInt(Math.round(Number(rate) * 1_000_000));
    return new Money(divideRounded(this.cents * micro, 1_000_000n));
  }

  negate(): Money {
    return new Money(-this.cents);
  }

  isZero(): boolean {
    return this.cents === 0n;
  }

  isNegative(): boolean {
    return this.cents < 0n;
  }

  compare(other: Money): number {
    return this.cents === other.cents ? 0 : this.cents < other.cents ? -1 : 1;
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  /** Representación para enviar a PostgreSQL (`numeric`). */
  toDecimalString(): string {
    const negative = this.cents < 0n;
    const abs = negative ? -this.cents : this.cents;
    const whole = abs / SCALE;
    const frac = (abs % SCALE).toString().padStart(2, '0');
    return `${negative ? '-' : ''}${whole}.${frac}`;
  }

  toNumber(): number {
    return Number(this.cents) / 100;
  }

  static sum(values: Money[]): Money {
    return values.reduce((acc, v) => acc.add(v), Money.zero);
  }
}

/** División entera con redondeo por mitad hacia el infinito según el signo. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}
