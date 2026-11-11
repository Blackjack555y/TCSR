import { randomUUID } from 'node:crypto';
import { nuevaReferencia, type Compra, type RepositorioCuentas } from '../cuentas/repositorio.js';
import type { TipoInforme } from '../dominio/tipos.js';
import { logger } from '../logger.js';
import { cotizar } from '../precios/catalogo.js';
import type { Notificador } from '../notificaciones/correo.js';
import { eventoValido, firmaIntegridad, type DatosWidget, type EventoWompi, type TransaccionWompi } from './wompi.js';
import type { ConsultorWompi } from './wompi-api.js';

export interface ConfigPagos {
  publicKey: string;
  secretoIntegridad: string;
  secretoEventos: string;
  redirectUrl?: string;
}

export type ResultadoEvento = 'firma_invalida' | 'procesado' | 'ignorado';

/** Ventana en la que la conciliación revisa compras pendientes. */
const CONCILIAR_DESDE_MS = 3 * 86_400_000;
const CONCILIAR_ESPERA_MS = 5 * 60_000;
const ESTADOS_FINALES_RECHAZO = new Set(['DECLINED', 'VOIDED', 'ERROR']);

export class ServicioPagos {
  constructor(
    private readonly cuentas: RepositorioCuentas,
    private readonly config: ConfigPagos,
    /** Sin llave privada no se puede consultar a Wompi: solo cuenta el webhook. */
    private readonly api: ConsultorWompi | null = null,
    private readonly notificador: Notificador | null = null
  ) {}

  /** Aplica a una compra el estado de su transacción en Wompi. Idempotente. */
  private async aplicar(t: TransaccionWompi): Promise<void> {
    if (t.status === 'APPROVED') {
      const r = await this.cuentas.aprobarCompra(t.reference, t.id, t.amount_in_cents, t.payment_method_type ?? null);
      if (r === 'aprobada') {
        logger.info('compra aprobada', { referencia: t.reference });
        const compra = await this.cuentas.obtenerCompraPorReferencia(t.reference);
        if (compra && this.notificador) void this.notificador.compraAprobada(compra);
      } else if (r !== 'ya_aprobada') {
        // Transacción auténtica que no cuadra: no se acredita y hay que revisarla a mano.
        logger.error('compra no acreditada', { referencia: t.reference, resultado: r });
      }
    } else if (ESTADOS_FINALES_RECHAZO.has(t.status)) {
      await this.cuentas.rechazarCompra(t.reference, t.id);
    }
  }

  /** Crea la compra pendiente y los datos con los que el frontend abre el widget de Wompi. */
  async iniciarCompra(usuarioId: string, tipo: TipoInforme, cantidad: number): Promise<{ compra: Compra; widget: DatosWidget }> {
    const c = cotizar(tipo, cantidad);
    const compra: Compra = {
      id: randomUUID(),
      usuarioId,
      tipo,
      cantidad,
      precioUnitario: c.precioUnitario,
      total: c.total,
      referencia: nuevaReferencia(),
      estado: 'pendiente',
      creadaEn: new Date().toISOString()
    };
    await this.cuentas.crearCompra(compra);

    const amountInCents = compra.total * 100;
    return {
      compra,
      widget: {
        publicKey: this.config.publicKey,
        currency: 'COP',
        amountInCents,
        reference: compra.referencia,
        signatureIntegrity: firmaIntegridad(compra.referencia, amountInCents, 'COP', this.config.secretoIntegridad),
        ...(this.config.redirectUrl && { redirectUrl: this.config.redirectUrl })
      }
    };
  }

  /** Procesa un evento de Wompi. Es idempotente: Wompi puede reenviarlo. */
  async procesarEvento(evento: EventoWompi): Promise<ResultadoEvento> {
    if (!eventoValido(evento, this.config.secretoEventos)) return 'firma_invalida';
    if (evento.event !== 'transaction.updated') return 'ignorado';

    const t = (evento.data as { transaction?: TransaccionWompi }).transaction;
    if (!t?.reference) return 'ignorado';
    await this.aplicar(t);
    return 'procesado';
  }

  /**
   * El navegador informa el id de la transacción que le dio Wompi; el servidor la consulta
   * con la llave privada y solo la aplica si pertenece a esta compra. Cubre el caso de un
   * webhook que no llegó.
   */
  async verificarCompra(usuarioId: string, compraId: string, transaccionId: string): Promise<Compra | null> {
    const compra = await this.cuentas.obtenerCompra(compraId);
    if (!compra || compra.usuarioId !== usuarioId) return null;
    if (compra.estado !== 'pendiente' || !this.api) return compra;

    const t = await this.api.obtenerTransaccion(transaccionId);
    if (!t || t.reference !== compra.referencia) return compra;

    await this.cuentas.registrarTransaccion(compra.id, t.id);
    await this.aplicar(t);
    return this.cuentas.obtenerCompra(compraId);
  }

  /** Revisa en Wompi las compras que siguen pendientes y ya tienen transacción. */
  async conciliarPendientes(ahora = new Date()): Promise<number> {
    if (!this.api) return 0;
    const desde = new Date(ahora.getTime() - CONCILIAR_DESDE_MS).toISOString();
    const hasta = new Date(ahora.getTime() - CONCILIAR_ESPERA_MS).toISOString();
    const pendientes = await this.cuentas.listarPendientesConTransaccion(desde, hasta);
    let resueltas = 0;
    for (const c of pendientes) {
      try {
        const t = await this.api.obtenerTransaccion(c.transaccionId!);
        if (t && t.reference === c.referencia && t.status !== 'PENDING') {
          await this.aplicar(t);
          resueltas++;
        }
      } catch (err) {
        logger.warn('conciliación: no se pudo consultar Wompi', { compra: c.id, causa: err instanceof Error ? err.message : String(err) });
      }
    }
    if (resueltas > 0) logger.info('compras conciliadas con Wompi', { cantidad: resueltas });
    return resueltas;
  }
}