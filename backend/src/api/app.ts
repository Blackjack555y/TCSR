import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { MENSAJES_ERROR, type Consulta } from '../consultas/modelo.js';
import { ServicioConsultas, SinSaldoError } from '../consultas/servicio.js';
import type { Compra, RepositorioCuentas } from '../cuentas/repositorio.js';
import type { Usuario, VerificadorSesion } from '../cuentas/sesion.js';
import { logger } from '../logger.js';
import type { ServicioPagos } from '../pagos/servicio.js';
import type { EventoWompi } from '../pagos/wompi.js';
import { cotizar, RANGOS } from '../precios/catalogo.js';
import type { VerificadorHumano } from './turnstile.js';
import { esquemaCompra, esquemaId, esquemaNuevaConsulta } from './validacion.js';

export interface OpcionesApp {
  servicio: ServicioConsultas;
  pagos: ServicioPagos;
  cuentas: RepositorioCuentas;
  verificarSesion: VerificadorSesion;
  verificarHumano: VerificadorHumano;
  origenes: string[];
  /** Desactiva los límites de peticiones (pruebas). */
  sinLimites?: boolean;
  /** Habilita rutas de ayuda para desarrollar sin Wompi. Nunca en producción. */
  rutasDesarrollo?: boolean;
}

type ConUsuario = Request & { usuario: Usuario };

const fallo = (res: Response, status: number, codigo: string, mensaje: string, extra?: object) =>
  res.status(status).json({ error: { codigo, mensaje, ...extra } });

export function crearApp(op: OpcionesApp) {
  const { servicio, pagos, cuentas, verificarSesion, verificarHumano, origenes, sinLimites } = op;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // detrás del proxy del hosting: la IP real viene en X-Forwarded-For
  app.use(express.json({ limit: '32kb' }));
  app.use(cors({ origin: origenes, methods: ['GET', 'POST'], allowedHeaders: ['Authorization', 'Content-Type'] }));
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  const limites = { standardHeaders: 'draft-8', legacyHeaders: false, skip: () => !!sinLimites } as const;
  const limiteEscritura = rateLimit({ ...limites, windowMs: 15 * 60_000, limit: 120,
    message: { error: { codigo: 'demasiadas_peticiones', mensaje: 'Hiciste muchas peticiones seguidas. Intenta de nuevo en unos minutos.' } } });
  const limiteLectura = rateLimit({ ...limites, windowMs: 60_000, limit: 120 });

  const conSesion = async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const usuario = token ? await verificarSesion(token) : null;
    if (!usuario) {
      fallo(res, 401, 'sesion_requerida', 'Inicia sesión para continuar.');
      return;
    }
    (req as ConUsuario).usuario = usuario;
    next();
  };
  const usuarioDe = (req: Request) => (req as ConUsuario).usuario;

  app.get('/api/salud', (_req, res) => {
    res.json({ ok: true });
  });

  // ---------- precios (públicos) ----------

  app.get('/api/precios', (_req, res) => {
    res.json({ moneda: 'COP', ivaIncluido: true, rangos: RANGOS });
  });

  app.get('/api/precios/cotizar', (req, res) => {
    const e = esquemaCompra.safeParse(req.query);
    if (!e.success) {
      fallo(res, 400, 'datos_invalidos', 'Revisa el tipo de informe y la cantidad.');
      return;
    }
    res.json(cotizar(e.data.tipo, e.data.cantidad));
  });

  // ---------- saldo y compras ----------

  app.get('/api/saldo', limiteLectura, conSesion, async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ saldos: await cuentas.saldos(usuarioDe(req).id) });
  });

  app.get('/api/compras', limiteLectura, conSesion, async (req, res) => {
    const compras = await cuentas.listarCompras(usuarioDe(req).id, 50);
    res.set('Cache-Control', 'no-store').json({ compras: compras.map(vistaCompra) });
  });

  // Crea la compra y devuelve lo necesario para abrir el widget de Wompi.
  app.post('/api/compras', limiteEscritura, conSesion, async (req, res) => {
    const e = esquemaCompra.safeParse(req.body);
    if (!e.success) {
      fallo(res, 400, 'datos_invalidos', 'Revisa el tipo de informe y la cantidad.');
      return;
    }
    const { compra, widget } = await pagos.iniciarCompra(usuarioDe(req).id, e.data.tipo, e.data.cantidad);
    res.status(201).json({ compra: vistaCompra(compra), widget });
  });

  // Solo una respuesta distinta de 200 hace que Wompi reintente.
  app.post('/api/webhooks/wompi', async (req, res) => {
    const r = await pagos.procesarEvento(req.body as EventoWompi);
    if (r === 'firma_invalida') {
      logger.warn('evento de Wompi con firma inválida');
      res.status(401).end();
      return;
    }
    res.status(200).end();
  });

  // ---------- consultas ----------

  app.post('/api/consultas', limiteEscritura, conSesion, async (req, res) => {
    const entrada = esquemaNuevaConsulta.safeParse(req.body);
    if (!entrada.success) {
      fallo(res, 400, 'datos_invalidos', 'Revisa los datos de la consulta.', {
        campos: entrada.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message }))
      });
      return;
    }

    const ip = req.ip ?? 'desconocida';
    if (!(await verificarHumano(entrada.data.turnstileToken, ip))) {
      fallo(res, 403, 'verificacion_fallida', 'No pudimos verificar que eres una persona. Recarga la página e intenta de nuevo.');
      return;
    }

    const { consentimiento, turnstileToken: _t, ...datos } = entrada.data;
    try {
      const { consulta, reutilizada } = await servicio.crear({ usuarioId: usuarioDe(req).id, entrada: datos, consentimiento, ip });
      res.status(reutilizada ? 200 : 202).location(`/api/consultas/${consulta.id}`).json(vistaPublica(consulta));
    } catch (err) {
      if (err instanceof SinSaldoError) {
        fallo(res, 402, 'sin_saldo', 'No tienes saldo para este tipo de informe. Compra informes para continuar.', { tipo: err.tipo });
        return;
      }
      throw err;
    }
  });

  app.get('/api/consultas', limiteLectura, conSesion, async (req, res) => {
    const lista = await servicio.historial(usuarioDe(req).id);
    res.set('Cache-Control', 'no-store').json({ consultas: lista.map(vistaPublica) });
  });

  app.get('/api/consultas/:id', limiteLectura, conSesion, async (req, res) => {
    const id = esquemaId.safeParse(req.params.id);
    const consulta = id.success ? await servicio.obtener(id.data, usuarioDe(req).id) : null;
    if (!consulta) {
      fallo(res, 404, 'no_existe', 'No encontramos esa consulta.');
      return;
    }
    res.set('Cache-Control', 'no-store').json(vistaPublica(consulta));
  });

  // PDF: ?descargar=1 lo entrega como archivo; sin el parámetro, para la vista previa.
  // Exige sesión, así que el frontend lo pide con fetch y lo muestra como blob.
  app.get('/api/consultas/:id/pdf', limiteLectura, conSesion, async (req, res) => {
    const id = esquemaId.safeParse(req.params.id);
    const r = id.success ? await servicio.leerPdf(id.data, usuarioDe(req).id) : { tipo: 'no_existe' as const };

    if (r.tipo !== 'ok') {
      const estados = {
        no_existe: [404, 'No encontramos ese informe.'],
        no_listo: [409, 'El informe todavía no está listo.'],
        vencido: [410, 'Este informe ya no está disponible: los informes se pueden descargar durante 7 días.']
      } as const;
      const [status, mensaje] = estados[r.tipo];
      fallo(res, status, r.tipo, mensaje);
      return;
    }

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${req.query.descargar === '1' ? 'attachment' : 'inline'}; filename="${r.nombre}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex'
    });
    res.send(r.pdf);
  });

  if (op.rutasDesarrollo) {
    // Simula el pago aprobado de una compra, para desarrollar sin Wompi.
    app.post('/api/dev/compras/:id/aprobar', conSesion, async (req, res) => {
      const compra = await cuentas.obtenerCompra(String(req.params.id));
      if (!compra || compra.usuarioId !== usuarioDe(req).id) {
        fallo(res, 404, 'no_existe', 'No encontramos esa compra.');
        return;
      }
      const resultado = await cuentas.aprobarCompra(compra.referencia, `dev-${compra.id}`, compra.total * 100, 'DEV');
      res.json({ resultado, saldos: await cuentas.saldos(usuarioDe(req).id) });
    });
  }

  app.use((_req: Request, res: Response) => {
    fallo(res, 404, 'ruta_no_existe', 'Ruta no encontrada.');
  });

  // Express 5 pasa aquí los errores de los handlers async.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      fallo(res, 400, 'datos_invalidos', 'El cuerpo de la petición no es JSON válido.');
      return;
    }
    logger.error('error no controlado', { causa: err instanceof Error ? err.message : String(err) });
    fallo(res, 500, 'error_interno', 'Algo falló de nuestro lado.');
  });

  return app;
}

function vistaCompra(c: Compra) {
  return {
    id: c.id, tipo: c.tipo, cantidad: c.cantidad, precioUnitario: c.precioUnitario,
    total: c.total, estado: c.estado, creadaEn: c.creadaEn
  };
}

/** Lo que el frontend puede ver de una consulta. Nunca incluye hashes ni la IP. */
export function vistaPublica(c: Consulta) {
  const base = `/api/consultas/${c.id}`;
  return {
    id: c.id,
    tipo: c.tipo,
    placa: c.placa,
    vin: c.vin,
    estado: c.estado,
    creadaEn: c.creadaEn,
    ...(c.error && {
      error: { codigo: c.error.codigo, ...MENSAJES_ERROR[c.error.codigo], reintentable: c.error.reintentable, saldoDevuelto: c.saldoDevuelto === true }
    }),
    ...(c.estado === 'completada' && c.informe && {
      resultado: {
        parcial: c.informe.parcial,
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
