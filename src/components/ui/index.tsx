import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

export function Card({
  children,
  className,
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-madera-200 bg-white shadow-sm',
        className,
      )}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-madera-100 px-4 py-3">
          {typeof title === 'string' ? (
            <h2 className="text-sm font-semibold text-madera-800">{title}</h2>
          ) : (
            title
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
};

const BUTTON_VARIANTS: Record<string, string> = {
  primary: 'bg-madera-600 text-white hover:bg-madera-700 disabled:bg-madera-300',
  secondary:
    'bg-white text-madera-800 border border-madera-300 hover:bg-madera-50 disabled:text-madera-400',
  ghost: 'text-madera-700 hover:bg-madera-100 disabled:text-madera-400',
  danger: 'bg-fuego-500 text-white hover:bg-fuego-600 disabled:bg-fuego-400/50',
};

const BUTTON_SIZES: Record<string, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
  lg: 'px-5 py-3 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-medium text-madera-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-madera-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-fuego-600">{error}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-madera-300 bg-white px-3 py-2 text-sm text-madera-900 ' +
  'placeholder:text-madera-400 focus:border-madera-500 focus:outline-none';

export function Input({
  ref,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  ref?: React.Ref<HTMLInputElement>;
}) {
  return <input ref={ref} {...props} className={cn(inputClass, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputClass, props.className)} />;
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-madera-100 text-madera-700',
    good: 'bg-emerald-100 text-emerald-800',
    warn: 'bg-amber-100 text-amber-800',
    bad: 'bg-red-100 text-red-800',
    info: 'bg-sky-100 text-sky-800',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-madera-800">{title}</p>
      {description && <p className="max-w-md text-sm text-madera-500">{description}</p>}
      {action}
    </div>
  );
}

/**
 * Cuando no hay historia suficiente se dice exactamente eso, en lugar de
 * inventar una proyección (principio 22.5).
 */
export function InsufficientData({ what }: { what: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm font-medium text-madera-700">Datos insuficientes</p>
      <p className="mt-1 text-xs text-madera-500">
        Todavía no hay suficiente historia para calcular {what}.
      </p>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const tones: Record<string, string> = {
    neutral: 'text-madera-900',
    good: 'text-emerald-700',
    warn: 'text-amber-700',
    bad: 'text-red-700',
  };
  return (
    <div className="rounded-xl border border-madera-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-madera-500">{label}</p>
      <p className={cn('tabular mt-1 text-xl font-semibold', tones[tone])}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-madera-500">{hint}</p>}
    </div>
  );
}
