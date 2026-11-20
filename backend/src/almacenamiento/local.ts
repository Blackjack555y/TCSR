import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Dónde se guardan los PDF. En producción irá Supabase Storage (bucket privado). */
export interface AlmacenamientoPdf {
  guardar(clave: string, pdf: Buffer): Promise<void>;
  leer(clave: string): Promise<Buffer | null>;
  borrar(clave: string): Promise<void>;
}

const CLAVE_VALIDA = /^[a-zA-Z0-9-]+\.pdf$/;

/** Almacenamiento en disco para desarrollo. */
export class AlmacenamientoLocal implements AlmacenamientoPdf {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  private ruta(clave: string): string {
    if (!CLAVE_VALIDA.test(clave)) throw new Error(`Clave de almacenamiento inválida: ${clave}`);
    return join(this.dir, clave);
  }

  async guardar(clave: string, pdf: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.ruta(clave), pdf);
  }

  async leer(clave: string): Promise<Buffer | null> {
    try {
      return await readFile(this.ruta(clave));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async borrar(clave: string): Promise<void> {
    await rm(this.ruta(clave), { force: true });
  }
}
