import type { SupabaseClient } from '@supabase/supabase-js';
import type { AlmacenamientoPdf } from '../almacenamiento/local.js';

const BUCKET = 'informes';

/** PDFs en el bucket privado de Supabase Storage. Solo el backend los lee. */
export class AlmacenamientoSupabase implements AlmacenamientoPdf {
  constructor(private readonly db: SupabaseClient) {}

  async guardar(clave: string, pdf: Buffer) {
    const { error } = await this.db.storage.from(BUCKET).upload(clave, pdf, { contentType: 'application/pdf', upsert: true });
    if (error) throw new Error(`guardar PDF: ${error.message}`);
  }

  async leer(clave: string) {
    const { data, error } = await this.db.storage.from(BUCKET).download(clave);
    if (error) {
      // El SDK no da un código uniforme: un objeto inexistente se trata como ausente.
      if (/not.?found/i.test(error.message) || (error as { status?: number }).status === 404) return null;
      throw new Error(`leer PDF: ${error.message}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async borrar(clave: string) {
    const { error } = await this.db.storage.from(BUCKET).remove([clave]);
    if (error) throw new Error(`borrar PDF: ${error.message}`);
  }
}
