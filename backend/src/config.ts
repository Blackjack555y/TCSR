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

  /** Sin Supabase, los datos quedan en memoria y disco (solo desarrollo). */
  SUPABASE_URL: z.url().optional(),
  /** Llave secreta (service role). Nunca debe llegar al frontend. */
  SUPABASE_LLAVE_SECRETA: z.string().optional(),

  /** Wompi: llaves del entorno de pruebas (pub_test_) o producción (pub_prod_). */
  WOMPI_LLAVE_PUBLICA: z.string().default('pub_test_desarrollo'),
  WOMPI_SECRETO_INTEGRIDAD: z.string().default('solo-para-desarrollo-integridad'),
  WOMPI_SECRETO_EVENTOS: z.string().default('solo-para-desarrollo-eventos'),
  /** A dónde vuelve el usuario después de pagar. */
  WOMPI_URL_REDIRECCION: z.url().optional(),

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
  if (c.SUPABASE_URL && !c.SUPABASE_LLAVE_SECRETA) {
    ctx.addIssue({ code: 'custom', path: ['SUPABASE_LLAVE_SECRETA'], message: 'Se requiere con SUPABASE_URL' });
  }
  if (c.NODE_ENV === 'production') {
    if (c.DOC_HASH_SECRETO === 'solo-para-desarrollo-cambiar') {
      ctx.addIssue({ code: 'custom', path: ['DOC_HASH_SECRETO'], message: 'Define un secreto propio en producción' });
    }
    const requeridas = ['TURNSTILE_SECRETO', 'SUPABASE_URL', 'SUPABASE_LLAVE_SECRETA'] as const;
    for (const k of requeridas) {
      if (!c[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'Se requiere en producción' });
    }
    for (const k of ['WOMPI_LLAVE_PUBLICA', 'WOMPI_SECRETO_INTEGRIDAD', 'WOMPI_SECRETO_EVENTOS'] as const) {
      if (/desarrollo/.test(c[k])) ctx.addIssue({ code: 'custom', path: [k], message: 'Se requiere en producción' });
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
