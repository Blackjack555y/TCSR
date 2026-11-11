import type { SupabaseClient } from '@supabase/supabase-js';

export interface Usuario {
  id: string;
  email: string | null;
}

/** Valida el token de sesión que envía el frontend. */
export type VerificadorSesion = (token: string) => Promise<Usuario | null>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Solo desarrollo y pruebas: el token "dev-<uuid>" representa a ese usuario. */
export const sesionDesarrollo: VerificadorSesion = async (token) => {
  const id = token.startsWith('dev-') ? token.slice(4) : '';
  return UUID.test(id) ? { id, email: `${id}@dev.local` } : null;
};

export function sesionSupabase(cliente: SupabaseClient): VerificadorSesion {
  return async (token) => {
    const { data, error } = await cliente.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  };
}
