import type { Compra } from '../cuentas/repositorio.js';
import type { TipoInforme } from '../dominio/tipos.js';
import { logger } from '../logger.js';

const NOMBRES: Record<TipoInforme, string> = { basico: 'Básico', vin: 'Por VIN', full: 'Full' };

export interface Correo {
  para: string;
  asunto: string;
  html: string;
  /** Evita enviar dos veces el mismo correo si un evento se repite. */
  idempotencia: string;
}

export interface EnviadorCorreo {
  enviar(c: Correo): Promise<void>;
}

/** Busca el correo de un usuario (Supabase Auth en producción). */
export type DirectorioUsuarios = (usuarioId: string) => Promise<string | null>;

/** Envía con Resend. https://resend.com/docs/api-reference/emails/send-email */
export class EnviadorResend implements EnviadorCorreo {
  constructor(private readonly llave: string, private readonly remitente: string) {}

  async enviar(c: Correo) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.llave}`, 'Content-Type': 'application/json', 'Idempotency-Key': c.idempotencia },
      body: JSON.stringify({ from: this.remitente, to: [c.para], subject: c.asunto, html: c.html }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) throw new Error(`Resend respondió ${res.status}`);
  }
}

/** Sin Resend configurado: solo deja constancia en el log (desarrollo). */
export class EnviadorRegistro implements EnviadorCorreo {
  readonly enviados: Correo[] = [];

  async enviar(c: Correo) {
    this.enviados.push(c);
    logger.info('correo (no enviado: sin Resend)', { asunto: c.asunto, idempotencia: c.idempotencia });
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]!);

function plantilla(sitio: string, titulo: string, texto: string, boton: string, enlace: string, nota: string) {
  return `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#131516;font-family:Arial,sans-serif;color:#f3f4f4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#1b1e20;border:1px solid #33383b;border-radius:18px" cellpadding="28" cellspacing="0"><tr><td>
<img src="https://xufwueysgfokiknwnnfy.supabase.co/storage/v1/object/public/marca/logo-icono.png" alt="" width="39" height="52" style="display:block;margin-bottom:18px;border:0">
<h1 style="font-size:22px;margin:0 0 10px">${titulo}</h1>
<p style="color:#a9afb2;line-height:1.6;margin:0 0 22px">${texto}</p>
<a href="${enlace}" style="display:inline-block;background:#f0a83c;color:#1a1206;font-weight:bold;text-decoration:none;padding:14px 26px;border-radius:999px">${boton}</a>
<p style="color:#a9afb2;font-size:13px;line-height:1.6;margin:22px 0 0">${nota}</p>
</td></tr></table>
<p style="color:#a9afb2;font-size:12px;margin:16px 0 0">Carro Sin Rollos no es el RUNT ni una entidad oficial.</p>
</td></tr></table></body></html>`;
}

const pesos = (n: number) => `$ ${new Intl.NumberFormat('es-CO').format(n)}`;
const fechaLarga = (iso: string) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long' }).format(new Date(iso));

/**
 * Avisos al cliente. Un correo que falla nunca frena la compra ni la consulta:
 * el saldo y el informe ya están en su panel.
 */
export class Notificador {
  constructor(
    private readonly enviador: EnviadorCorreo,
    private readonly correoDe: DirectorioUsuarios,
    private readonly sitio: string
  ) {}

  private async enviar(usuarioId: string, armar: (para: string) => Correo) {
    try {
      const para = await this.correoDe(usuarioId);
      if (!para) return;
      await this.enviador.enviar(armar(para));
    } catch (err) {
      logger.error('correo fallido', { causa: err instanceof Error ? err.message : String(err) });
    }
  }

  compraAprobada(c: Compra) {
    return this.enviar(c.usuarioId, (para) => ({
      para,
      idempotencia: `compra-${c.id}`,
      asunto: 'Tu compra fue aprobada · Carro Sin Rollos',
      html: plantilla(this.sitio, 'Tu compra fue aprobada',
        `Ya tienes ${c.cantidad} ${c.cantidad === 1 ? 'informe' : 'informes'} ${NOMBRES[c.tipo]} en tu saldo, por ${pesos(c.total)}. Tu saldo no vence.`,
        'Analizar un vehículo', `${this.sitio}/consultar.html?tipo=${c.tipo}`,
        'Si no hiciste esta compra, responde este correo.')
    }));
  }

  informeListo(usuarioId: string, consultaId: string, placa: string | null, venceEn: string) {
    return this.enviar(usuarioId, (para) => ({
      para,
      idempotencia: `informe-${consultaId}`,
      asunto: `Tu informe${placa ? ` de ${placa}` : ''} está listo · Carro Sin Rollos`,
      html: plantilla(this.sitio, 'Tu informe está listo',
        `El informe${placa ? ` del vehículo <strong style="color:#f3f4f4">${esc(placa)}</strong>` : ''} ya se puede ver y descargar.`,
        'Ver mi informe', `${this.sitio}/informe.html?id=${consultaId}`,
        `Lo puedes descargar hasta el ${fechaLarga(venceEn)}. Después se elimina.`)
    }));
  }
}
