import type { Consulta } from './modelo.js';

/** Persistencia de consultas. */
export interface RepositorioConsultas {
  crear(c: Consulta): Promise<void>;
  obtener(id: string): Promise<Consulta | null>;
  actualizar(id: string, cambios: Partial<Consulta>): Promise<Consulta | null>;
  listarDeUsuario(usuarioId: string, limite: number): Promise<Consulta[]>;
  /** Consulta más reciente del usuario con esa huella, creada después de `desde`. */
  buscarReciente(usuarioId: string, huella: string, desde: string): Promise<Consulta | null>;
  /** Consultas con PDF cuya vigencia terminó antes de `ahora`. */
  listarVencidas(ahora: string): Promise<Consulta[]>;
  /** Consultas que quedaron a medias, por ejemplo por un reinicio del servidor. */
  listarColgadas(antesDe: string): Promise<Consulta[]>;
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

  async listarDeUsuario(usuarioId: string, limite: number) {
    return [...this.datos.values()]
      .filter((c) => c.usuarioId === usuarioId)
      .sort((a, b) => b.creadaEn.localeCompare(a.creadaEn))
      .slice(0, limite)
      .map((c) => structuredClone(c));
  }

  async buscarReciente(usuarioId: string, huella: string, desde: string) {
    const [c] = [...this.datos.values()]
      .filter((x) => x.usuarioId === usuarioId && x.huella === huella && x.creadaEn >= desde)
      .sort((a, b) => b.creadaEn.localeCompare(a.creadaEn));
    return c ? structuredClone(c) : null;
  }

  async listarVencidas(ahora: string) {
    return [...this.datos.values()].filter((c) => c.pdfClave && c.venceEn && c.venceEn < ahora).map((c) => structuredClone(c));
  }

  async listarColgadas(antesDe: string) {
    return [...this.datos.values()]
      .filter((c) => (c.estado === 'en_curso' || c.estado === 'generando_pdf') && c.creadaEn < antesDe)
      .map((c) => structuredClone(c));
  }
}
