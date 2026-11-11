import type { TransaccionWompi } from './wompi.js';

/**
 * Consulta transacciones en Wompi con la llave privada, desde el servidor.
 * Documentado: GET /v1/transactions/{id}. La consulta por referencia no está documentada,
 * por eso se usa el id que devuelven el widget y la redirección.
 * https://docs.wompi.co/docs/colombia/seguimiento-de-transacciones/
 */
export interface ConsultorWompi {
  obtenerTransaccion(id: string): Promise<TransaccionWompi | null>;
}

export class ApiWompi implements ConsultorWompi {
  private readonly base: string;

  constructor(private readonly llavePrivada: string) {
    // TODO: confirmar la URL del entorno de pruebas al abrir la cuenta.
    this.base = llavePrivada.startsWith('prv_test_') ? 'https://sandbox.wompi.co/v1' : 'https://production.wompi.co/v1';
  }

  async obtenerTransaccion(id: string): Promise<TransaccionWompi | null> {
    const res = await fetch(`${this.base}/transactions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${this.llavePrivada}` },
      signal: AbortSignal.timeout(15_000)
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Wompi respondió ${res.status}`);
    const cuerpo = (await res.json()) as { data?: TransaccionWompi } & Partial<TransaccionWompi>;
    return cuerpo.data ?? (cuerpo.id ? (cuerpo as TransaccionWompi) : null);
  }
}
