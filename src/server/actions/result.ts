import { PostgrestError } from '@supabase/supabase-js';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

/**
 * Traduce el error de PostgreSQL a algo que se pueda leer en el mostrador.
 *
 * Los mensajes de las funciones de dominio ya vienen escritos en español y
 * pensados para mostrarse tal cual; los errores estructurales de la base, no.
 */
export function describeError(error: PostgrestError | Error | unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: string }).message);
    const code = (error as PostgrestError).code;

    if (code === '42501' || message.includes('row-level security')) {
      return 'No tenés permiso para hacer esta operación.';
    }
    if (code === '23505' && message.includes('cash_sessions_one_open_uq')) {
      return 'Ya hay una sesión de caja abierta en esta caja.';
    }
    if (code === '23505' && message.includes('idempotency')) {
      return 'Esa operación ya se había registrado.';
    }
    if (code === '23505') {
      return 'Ese registro ya existe.';
    }
    // Los `raise exception` de las funciones traen el texto ya redactado.
    return message.replace(/^ERROR:\s*/, '');
  }
  return 'Ocurrió un error inesperado. Volvé a intentar.';
}
