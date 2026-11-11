import { randomUUID } from 'node:crypto';
import { nuevaReferencia, type Compra, type RepositorioCuentas } from '../cuentas/repositorio.js';
import type { TipoInforme } from '../dominio/tipos.js';
import { logger } from '../logger.js';
import { cotizar } from '../precios/catalogo.js';
import { eventoValido, firmaIntegridad, type DatosWidget, type EventoWompi, type TransaccionWompi } from './wompi.js';

export interface ConfigPagos {
  publicKey: string;
  secretoIntegridad: string;
  secretoEventos: string;
  redirectUrl?: string;
}

export type ResultadoEvento = 'firma_invalida' | 'procesado' | 'ignorado';

export class ServicioPagos {
  constructor(
    private readonly cuentas: RepositorioCuentas,
    private readonly config: ConfigPagos
  ) {}

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

    if (t.status === 'APPROVED') {
      const r = await this.cuentas.aprobarCompra(t.reference, t.id, t.amount_in_cents, t.payment_method_type ?? null);
      if (r === 'aprobada' || r === 'ya_aprobada') {
        logger.info('compra aprobada', { referencia: t.reference, resultado: r });
      } else {
        // Evento auténtico que no cuadra: no se acredita y hay que revisarlo a mano.
        logger.error('compra no acreditada', { referencia: t.reference, resultado: r });
      }
      return 'procesado';
    }
    if (t.status === 'DECLINED' || t.status === 'VOIDED' || t.status === 'ERROR') {
      await this.cuentas.rechazarCompra(t.reference, t.id);
      return 'procesado';
    }
    return 'ignorado';
  }
}
