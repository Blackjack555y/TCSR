import { z } from 'zod';
import { CANTIDAD_MAXIMA } from '../precios/catalogo.js';

// Mismas reglas que frontend/js/landing.js. Si cambian aquí, cambian allá.

const PLACA_RE = /^(?:[A-Z]{3}\d{3}|[A-Z]{3}\d{2}[A-Z]?|[A-Z]{4}\d{2}|[RS]\d{5})$/;
/** El VIN no usa I, O ni Q. */
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

const DOCUMENTO_RE = {
  CC: /^\d{3,11}$/,
  CE: /^\d{3,11}$/,
  NIT: /^\d{9,10}$/,
  PA: /^[A-Z0-9]{4,15}$/,
  PPT: /^[A-Z0-9]{4,15}$/
} as const;

const placa = z.string().transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).pipe(z.string().regex(PLACA_RE, 'Placa inválida'));
const vin = z.string().transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).pipe(z.string().regex(VIN_RE, 'VIN inválido'));

const comunes = {
  consentimiento: z.object({
    aceptado: z.literal(true, 'Se requiere aceptar el aviso de privacidad'),
    version: z.string().min(1).max(40)
  }),
  turnstileToken: z.string().max(2048).optional()
};

export const esquemaNuevaConsulta = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('basico'), placa, ...comunes }),
  z.object({ tipo: z.literal('vin'), vin, ...comunes }),
  z.object({
    tipo: z.literal('full'),
    placa,
    docType: z.enum(['CC', 'CE', 'NIT', 'PA', 'PPT']),
    docNumber: z.string().transform((s) => s.toUpperCase().replace(/[\s.\-]/g, '')),
    ...comunes
  }).superRefine((v, ctx) => {
    if (!DOCUMENTO_RE[v.docType].test(v.docNumber)) {
      ctx.addIssue({ code: 'custom', path: ['docNumber'], message: 'Documento inválido para el tipo indicado' });
    }
  })
]);

export const esquemaTipo = z.enum(['basico', 'vin', 'full']);

export const esquemaCompra = z.object({
  tipo: esquemaTipo,
  cantidad: z.coerce.number().int().min(1).max(CANTIDAD_MAXIMA)
});

export const esquemaId = z.uuid();
