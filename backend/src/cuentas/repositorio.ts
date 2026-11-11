import { randomUUID } from 'node:crypto';
import type { TipoInforme } from '../dominio/tipos.js';

export type EstadoCompra = 'pendiente' | 'aprobada' | 'rechazada';

export interface Compra {
  id: string;
  usuarioId: string;
  tipo: TipoInforme;
  cantidad: number;
  precioUnitario: number;
  total: number;
  referencia: string;
  estado: EstadoCompra;
  creadaEn: string;
  /** Id de la transacción en Wompi, cuando ya se conoce. */
  transaccionId?: string | null;
}

export type ResultadoAprobacion = 'aprobada' | 'ya_aprobada' | 'no_existe' | 'monto_no_coincide';

export type Saldos = Record<TipoInforme, number>;

/** Compras y saldo. Las operaciones del saldo son atómicas e idempotentes. */
export interface RepositorioCuentas {
  saldos(usuarioId: string): Promise<Saldos>;
  crearCompra(c: Compra): Promise<void>;
  obtenerCompra(id: string): Promise<Compra | null>;
  obtenerCompraPorReferencia(referencia: string): Promise<Compra | null>;
  listarCompras(usuarioId: string, limite: number): Promise<Compra[]>;
  aprobarCompra(referencia: string, transaccionId: string, montoCentavos: number, medioPago: string | null): Promise<ResultadoAprobacion>;
  rechazarCompra(referencia: string, transaccionId: string): Promise<void>;
  /** Asocia la transacción de Wompi a una compra pendiente (ya verificada contra Wompi). */
  registrarTransaccion(compraId: string, transaccionId: string): Promise<void>;
  /** Compras pendientes con transacción conocida, creadas entre `desde` y `hasta`. */
  listarPendientesConTransaccion(desde: string, hasta: string): Promise<Compra[]>;
  /** Descuenta un informe. Devuelve false si no hay saldo. */
  consumirSaldo(usuarioId: string, tipo: TipoInforme, consultaId: string): Promise<boolean>;
  /** Devuelve el informe de una consulta fallida, una sola vez. */
  devolverSaldo(consultaId: string): Promise<boolean>;
}

export const nuevaReferencia = () => `CSR-${randomUUID()}`;

/** Implementación en memoria para desarrollo y pruebas. */
export class CuentasMemoria implements RepositorioCuentas {
  private readonly compras = new Map<string, Compra>();
  private readonly saldo = new Map<string, number>();
  private readonly consumos = new Map<string, { usuarioId: string; tipo: TipoInforme }>();
  private readonly devueltas = new Set<string>();

  private clave = (u: string, t: TipoInforme) => `${u}:${t}`;

  async saldos(usuarioId: string): Promise<Saldos> {
    const de = (t: TipoInforme) => this.saldo.get(this.clave(usuarioId, t)) ?? 0;
    return { basico: de('basico'), vin: de('vin'), full: de('full') };
  }

  async crearCompra(c: Compra) {
    this.compras.set(c.id, { ...c });
  }

  async obtenerCompra(id: string) {
    const c = this.compras.get(id);
    return c ? { ...c } : null;
  }

  async obtenerCompraPorReferencia(referencia: string) {
    const c = [...this.compras.values()].find((x) => x.referencia === referencia);
    return c ? { ...c } : null;
  }

  async listarCompras(usuarioId: string, limite: number) {
    return [...this.compras.values()]
      .filter((c) => c.usuarioId === usuarioId)
      .sort((a, b) => b.creadaEn.localeCompare(a.creadaEn))
      .slice(0, limite);
  }

  async aprobarCompra(referencia: string, transaccionId: string, montoCentavos: number, _medioPago: string | null = null): Promise<ResultadoAprobacion> {
    const c = [...this.compras.values()].find((x) => x.referencia === referencia);
    if (!c) return 'no_existe';
    if (c.estado === 'aprobada') return 'ya_aprobada';
    if (montoCentavos !== c.total * 100) return 'monto_no_coincide';
    c.estado = 'aprobada';
    c.transaccionId = transaccionId;
    const k = this.clave(c.usuarioId, c.tipo);
    this.saldo.set(k, (this.saldo.get(k) ?? 0) + c.cantidad);
    return 'aprobada';
  }

  async rechazarCompra(referencia: string) {
    const c = [...this.compras.values()].find((x) => x.referencia === referencia);
    if (c?.estado === 'pendiente') c.estado = 'rechazada';
  }

  async registrarTransaccion(compraId: string, transaccionId: string) {
    const c = this.compras.get(compraId);
    if (c?.estado === 'pendiente') c.transaccionId = transaccionId;
  }

  async listarPendientesConTransaccion(desde: string, hasta: string) {
    return [...this.compras.values()]
      .filter((c) => c.estado === 'pendiente' && c.transaccionId && c.creadaEn >= desde && c.creadaEn <= hasta)
      .map((c) => ({ ...c }));
  }

  async consumirSaldo(usuarioId: string, tipo: TipoInforme, consultaId: string) {
    const k = this.clave(usuarioId, tipo);
    const actual = this.saldo.get(k) ?? 0;
    if (actual <= 0) return false;
    this.saldo.set(k, actual - 1);
    this.consumos.set(consultaId, { usuarioId, tipo });
    return true;
  }

  async devolverSaldo(consultaId: string) {
    const c = this.consumos.get(consultaId);
    if (!c || this.devueltas.has(consultaId)) return false;
    this.devueltas.add(consultaId);
    const k = this.clave(c.usuarioId, c.tipo);
    this.saldo.set(k, (this.saldo.get(k) ?? 0) + 1);
    return true;
  }
}
