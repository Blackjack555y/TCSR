import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Cliente de servidor con la llave secreta: omite RLS. Nunca debe llegar al frontend. */
export function crearClienteServidor(url: string, llaveSecreta: string): SupabaseClient {
  return createClient(url, llaveSecreta, { auth: { persistSession: false, autoRefreshToken: false } });
}
