/** Formato es-AR para toda la interfaz. */
import { Money } from './money';

export const LOCALE = 'es-AR';
export const TIMEZONE = 'America/Argentina/Buenos_Aires';

const currencyFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3 });

export function formatMoney(value: Money | string | number | null | undefined): string {
  const money = value instanceof Money ? value : Money.parse(value ?? 0);
  return currencyFormatter.format(money.toNumber());
}

export function formatQuantity(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return numberFormatter.format(n);
}

export function formatPercent(rate: string | number | null | undefined, digits = 1): string {
  const n = Number(rate ?? 0) * 100;
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(n)}%`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** «hace 3 días», para listados operativos. */
export function formatRelativeDays(days: number): string {
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
  const years = Math.floor(months / 12);
  return `hace ${years} ${years === 1 ? 'año' : 'años'}`;
}
