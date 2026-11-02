import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { MENSAJES_ERROR, type Consulta } from '../consultas/modelo.js';
import type { ServicioConsultas } from '../consultas/servicio.js';
import { logger } from '../logger.js';
import type { VerificadorHumano } from './turnstile.js';
import { esquemaId, esquemaNuevaConsulta } from './validacion.js';

export interface OpcionesApp {
  servicio: ServicioConsultas;
  verificarHumano: VerificadorHumano;
  origenes: string[];
  /** Desactiva los límites de peticiones (pruebas). */
  sinLimites?: boolean;
}

export function crearApp({ servicio, verificarHumano, origenes, sinLimites }: OpcionesApp) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // detrás del proxy del hosting: la IP real viene en X-Forwarded-For
  app.use(express.json({ limit: '10kb' }));
  app.use(cors({ origin: origenes, methods: ['GET', 'POST'] }));
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  const limiteCrear = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, skip: () => !!sinLimites,
    message: { error: { codigo: 'demasiadas_consultas', mensaje: 'Hiciste muchas consultas seguidas. Intenta de nuevo en unos minutos.' } } });
  const limiteLeer = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, skip: () => !!sinLimites });

  app.get('/api/salud', (_req, res) => {
    res.json({ ok: true });
  });

  // Crea la consulta y responde de inmediato. El informe se arma en segundo plano.
  app.post('/api/consultas', limiteCrear, async (req: Request, res: Response) => {
    const entrada = esquemaNuevaConsulta.safeParse(req.body);
    if (!entrada.success) {
      res.status(400).json({
        error: {
          codigo: 'datos_invalidos',
          mensaje: 'Revisa los datos de la consulta.',
          campos: entrada.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message }))
        }
      });
      return;
    }

    const ip = req.ip ?? 'desconocida';
    if (!(await verificarHumano(entrada.data.turnstileToken, ip))) {
      res.status(403).json({ error: { codigo: 'verificacion_fallida', mensaje: 'No pudimos verificar que eres una persona. Recarga la página e intenta de nuevo.' } });
      return;
    }

    const { placa, docType, docNumber, consentimiento } = entrada.data;
    const { consulta, reutilizada } = await servicio.crear({ placa, docType, docNumber, consentimiento, ip });
    res.status(reutilizada ? 200 : 202).location(`/api/consultas/${consulta.id}`).json(vistaPublica(consulta));
  });

  app.get('/api/consultas/:id', limiteLeer, async (req: Request, res: Response) => {
    const id = esquemaId.safeParse(req.params.id);
    const consulta = id.success ? await servicio.obtener(id.data) : null;
    if (!consulta) {
      res.status(404).json({ error: { codigo: 'no_existe', mensaje: 'No encontramos esa consulta.' } });
      return;
    }
    res.set('Cache-Control', 'no-store').json(vistaPublica(consulta));
  });

  // PDF: ?descargar=1 lo entrega como archivo; sin el parámetro, para la vista previa.
  app.get('/api/consultas/:id/pdf', limiteLeer, async (req: Request, res: Response) => {
    const id = esquemaId.safeParse(req.params.id);
    const r = id.success ? await servicio.leerPdf(id.data) : { tipo: 'no_existe' as const };

    if (r.tipo !== 'ok') {
      const estados = {
        no_existe: [404, 'No encontramos ese informe.'],
        no_listo: [409, 'El informe todavía no está listo.'],
        vencido: [410, 'Este informe ya no está disponible: los informes se pueden descargar durante 7 días.']
      } as const;
      const [status, mensaje] = estados[r.tipo];
      res.status(status).json({ error: { codigo: r.tipo, mensaje } });
      return;
    }

    const descargar = req.query.descargar === '1';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${descargar ? 'attachment' : 'inline'}; filename="informe-${r.placa}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
      // Permite mostrar la vista previa en un iframe solo desde el frontend.
      'Content-Security-Policy': `frame-ancestors 'self' ${origenes.join(' ')}`
    });
    res.send(r.pdf);
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { codigo: 'ruta_no_existe', mensaje: 'Ruta no encontrada.' } });
  });

  // Express 5 pasa aquí los errores de los handlers async.
  app.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: { codigo: 'datos_invalidos', mensaje: 'El cuerpo de la petición no es JSON válido.' } });
      return;
    }
    logger.error('error no controlado', { causa: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: { codigo: 'error_interno', mensaje: 'Algo falló de nuestro lado.' } });
  });

  return app;
}

/** Lo que el frontend puede ver de una consulta. Nunca incluye el hash del documento ni la IP. */
export function vistaPublica(c: Consulta) {
  const base = `/api/consultas/${c.id}`;
  return {
    id: c.id,
    placa: c.placa,
    estado: c.estado,
    creadaEn: c.creadaEn,
    ...(c.error && {
      error: { codigo: c.error.codigo, ...MENSAJES_ERROR[c.error.codigo], reintentable: c.error.reintentable }
    }),
    ...(c.estado === 'completada' && c.informe && {
      resultado: {
        conclusion: {
          nivel: c.informe.conclusion.nivel,
          titulo: c.informe.conclusion.titulo,
          descripcion: c.informe.conclusion.descripcion,
          aspectosAtencion: c.informe.conclusion.aspectosAtencion,
          noDisponibles: c.informe.conclusion.noDisponibles
        },
        vehiculo: c.informe.vehiculo.descripcion,
        codigoVerificacion: c.informe.codigoVerificacion,
        venceEn: c.venceEn,
        pdf: { vistaPrevia: `${base}/pdf`, descarga: `${base}/pdf?descargar=1` }
      }
    }),
    ...(c.estado === 'vencida' && {
      error: { codigo: 'vencida', titulo: 'Informe vencido', mensaje: 'Los informes se pueden ver y descargar durante 7 días. Haz una nueva consulta.', reintentable: true }
    })
  };
}
