'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente del navegador. Solo para lectura y para el flujo de sesión.
 * Toda escritura con efecto contable pasa por Server Actions, que a su vez
 * llaman a las funciones transaccionales de la base.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
