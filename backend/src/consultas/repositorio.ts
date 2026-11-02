import type { Consulta } from './modelo.js';

/** Persistencia de consultas. En producción irá Supabase (ver db/migraciones). */
export interface RepositorioConsultas {
  crear(c: Consulta): Promise<void>;
  obtener(id: string): Promise<Consulta | null>;
  actualizar(id: string, cambios: Partial<Consulta>): Promise<Consulta | null>;
  /** Consulta más reciente de la misma placa y documento, creada después de `desde`. */
  buscarReciente(placa: string, docHash: string, desde: string): Promise<Consulta | null>;
  /** Consultas con PDF cuya vigencia terminó antes de `ahora`. */
  listarVencidas(ahora: string): Promise<Consulta[]>;
}

/** Repositorio en memoria para desarrollo y pruebas. Se pierde al reiniciar. */
export class RepositorioMemoria implements RepositorioConsultas {
  private readonly datos = new Map<string, Consulta>();

  async crear(c: Consulta) {
    this.datos.set(c.id, structuredClone(c));
  }

  async obtener(id: string) {
    const c = this.datos.get(id);
    return c ? structuredClone(c) : null;
  }

  async actualizar(id: string, cambios: Partial<Consulta>) {
    const actual = this.datos.get(id);
    if (!actual) return null;
    const nueva = { ...actual, ...structuredClone(cambios), actualizadaEn: new Date().toISOString() };
    this.datos.set(id, nueva);
    return structuredClone(nueva);
  }

  async buscarReciente(placa: string, docHash: string, desde: string) {
    let mejor: Consulta | null = null;
    for (const c of this.datos.values()) {
      if (c.placa === placa && c.docHash === docHash && c.creadaEn >= desde && (!mejor || c.creadaEn > mejor.creadaEn)) {
        mejor = c;
      }
    }
    return mejor ? structuredClone(mejor) : null;
  }

  async listarVencidas(ahora: string) {
    return [...this.datos.values()].filter((c) => c.pdfClave && c.venceEn && c.venceEn < ahora).map((c) => structuredClone(c));
  }
}
