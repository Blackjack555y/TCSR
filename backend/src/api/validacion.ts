import { z } from 'zod';

// Mismas reglas que frontend/js/landing.js. Si cambian aquí, cambian allá.

const PLACA_RE = /^(?:[A-Z]{3}\d{3}|[A-Z]{3}\d{2}[A-Z]?|[A-Z]{4}\d{2}|[RS]\d{5})$/;

const DOCUMENTO_RE = {
  CC: /^\d{3,11}$/,
  CE: /^\d{3,11}$/,
  NIT: /^\d{9,10}$/,
  PA: /^[A-Z0-9]{4,15}$/,
  PPT: /^[A-Z0-9]{4,15}$/
} as const;

export const esquemaNuevaConsulta = z
  .object({
    placa: z.string().transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).pipe(z.string().regex(PLACA_RE, 'Placa inválida')),
    docType: z.enum(['CC', 'CE', 'NIT', 'PA', 'PPT']),
    docNumber: z.string().transform((s) => s.toUpperCase().replace(/[\s.\-]/g, '')),
    consentimiento: z.object({
      aceptado: z.literal(true, 'Se requiere aceptar el aviso de privacidad'),
      version: z.string().min(1).max(40)
    }),
    turnstileToken: z.string().max(2048).optional()
  })
  .superRefine((v, ctx) => {
    if (!DOCUMENTO_RE[v.docType].test(v.docNumber)) {
      ctx.addIssue({ code: 'custom', path: ['docNumber'], message: 'Documento inválido para el tipo indicado' });
    }
  });

export type EntradaNuevaConsulta = z.infer<typeof esquemaNuevaConsulta>;

export const esquemaId = z.uuid();
