import { createHash, timingSafeEqual } from 'node:crypto';

// Referencias: https://docs.wompi.co/docs/colombia/widget-checkout-web/
//              https://docs.wompi.co/docs/colombia/eventos/

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface DatosWidget {
  publicKey: string;
  currency: 'COP';
  amountInCents: number;
  reference: string;
  signatureIntegrity: string;
  redirectUrl?: string;
}

/** Firma de integridad: impide cambiar el monto desde el navegador. Solo se calcula en el servidor. */
export function firmaIntegridad(referencia: string, montoCentavos: number, moneda: string, secreto: string): string {
  return sha256(`${referencia}${montoCentavos}${moneda}${secreto}`);
}

export interface EventoWompi {
  event: string;
  data: Record<string, unknown>;
  environment?: string;
  signature: { properties: string[]; checksum: string };
  timestamp: number;
}

export interface TransaccionWompi {
  id: string;
  status: string;
  reference: string;
  amount_in_cents: number;
  payment_method_type?: string;
}

function valorEn(data: Record<string, unknown>, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], data);
}

/**
 * Verifica que el evento venga de Wompi. Las propiedades firmadas se leen del propio
 * evento porque Wompi puede cambiarlas: concatena sus valores, el timestamp y el secreto.
 */
export function eventoValido(e: EventoWompi, secretoEventos: string): boolean {
  const props = e.signature?.properties;
  const checksum = e.signature?.checksum;
  if (!Array.isArray(props) || typeof checksum !== 'string') return false;

  const base = props.map((p) => String(valorEn(e.data ?? {}, p))).join('');
  const esperado = Buffer.from(sha256(`${base}${e.timestamp}${secretoEventos}`));
  const recibido = Buffer.from(checksum.toLowerCase());
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}
