import { z } from 'zod';

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  /** "simulado" usa respuestas guardadas y no gasta créditos. */
  PLACAPI_MODO: z.enum(['simulado', 'real']).default('simulado'),
  PLACAPI_URL: z.url().default('https://placapi.com/api'),
  PLACAPI_KEY: z.string().optional(),
  PLACAPI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  /** Orígenes permitidos para CORS, separados por coma. */
  CORS_ORIGENES: z.string().default('http://localhost:5173,http://localhost:3000'),

  /** Clave secreta para el hash del documento del propietario. */
  DOC_HASH_SECRETO: z.string().min(16).default('solo-para-desarrollo-cambiar'),

  /** Cloudflare Turnstile. Sin secreto, la verificación se omite (solo desarrollo). */
  TURNSTILE_SECRETO: z.string().optional(),

  /** Días que el PDF se puede ver y descargar. */
  PDF_DIAS_VIGENCIA: z.coerce.number().int().positive().default(7),
  /** Ruta a un Chrome/Chromium del sistema. Vacío = el que instala Playwright. */
  CHROME_PATH: z.string().optional(),
  /** Carpeta para guardar los PDF con el almacenamiento local. */
  ALMACENAMIENTO_DIR: z.string().default('data/pdfs')
}).superRefine((c, ctx) => {
  if (c.PLACAPI_MODO === 'real' && !c.PLACAPI_KEY) {
    ctx.addIssue({ code: 'custom', path: ['PLACAPI_KEY'], message: 'Se requiere con PLACAPI_MODO=real' });
  }
  if (c.NODE_ENV === 'production') {
    if (c.DOC_HASH_SECRETO === 'solo-para-desarrollo-cambiar') {
      ctx.addIssue({ code: 'custom', path: ['DOC_HASH_SECRETO'], message: 'Define un secreto propio en producción' });
    }
    if (!c.TURNSTILE_SECRETO) {
      ctx.addIssue({ code: 'custom', path: ['TURNSTILE_SECRETO'], message: 'Se requiere en producción' });
    }
  }
});

export type Config = z.infer<typeof esquema>;

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = esquema.safeParse(env);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuración inválida:\n  ${detalle}`);
  }
  return r.data;
}
