import { AlmacenamientoLocal } from './almacenamiento/local.js';
import { crearApp } from './api/app.js';
import { crearVerificadorTurnstile } from './api/turnstile.js';
import { cargarConfig } from './config.js';
import { RepositorioMemoria } from './consultas/repositorio.js';
import { ServicioConsultas } from './consultas/servicio.js';
import { CuentasMemoria } from './cuentas/repositorio.js';
import { correoSupabase, sesionDesarrollo, sesionSupabase } from './cuentas/sesion.js';
import { logger } from './logger.js';
import { EnviadorRegistro, EnviadorResend, Notificador } from './notificaciones/correo.js';
import { ApiWompi } from './pagos/wompi-api.js';
import { ServicioPagos } from './pagos/servicio.js';
import { RenderizadorPdf } from './pdf/render.js';
import { crearFuente } from './placapi/index.js';
import { crearHasher } from './privacidad/hash.js';
import { AlmacenamientoSupabase } from './supabase/almacenamiento.js';
import { crearClienteServidor } from './supabase/cliente.js';
import { ConsultasSupabase } from './supabase/consultas.js';
import { CuentasSupabase } from './supabase/cuentas.js';

const config = cargarConfig();
const pdf = new RenderizadorPdf(config.CHROME_PATH);
const esProduccion = config.NODE_ENV === 'production';

// Con Supabase configurado se usa de verdad; sin él, memoria y disco (solo desarrollo).
const db = config.SUPABASE_URL ? crearClienteServidor(config.SUPABASE_URL, config.SUPABASE_LLAVE_SECRETA!) : null;
const repo = db ? new ConsultasSupabase(db) : new RepositorioMemoria();
const cuentas = db ? new CuentasSupabase(db) : new CuentasMemoria();
const almacenamiento = db ? new AlmacenamientoSupabase(db) : new AlmacenamientoLocal(config.ALMACENAMIENTO_DIR);

if (!config.RESEND_LLAVE) logger.warn('sin RESEND_LLAVE: los correos de compra e informe no se envían');
const notificador = new Notificador(
  config.RESEND_LLAVE ? new EnviadorResend(config.RESEND_LLAVE, config.CORREO_REMITENTE, config.CORREO_SOPORTE) : new EnviadorRegistro(),
  db ? correoSupabase(db) : async (id) => `${id}@dev.local`,
  config.SITIO_URL.replace(/\/$/, ''),
  !!(config.RESEND_LLAVE && config.CORREO_SOPORTE)
);

const servicio = new ServicioConsultas({
  repo,
  cuentas,
  fuente: crearFuente(config),
  pdf,
  almacenamiento,
  hash: crearHasher(config.DOC_HASH_SECRETO),
  diasVigencia: config.PDF_DIAS_VIGENCIA,
  notificador,
  limiteFallidasDia: config.LIMITE_FALLIDAS_DIA,
  alertaCreditosDia: config.ALERTA_CREDITOS_DIA
});

const pagos = new ServicioPagos(cuentas, {
  publicKey: config.WOMPI_LLAVE_PUBLICA,
  secretoIntegridad: config.WOMPI_SECRETO_INTEGRIDAD,
  secretoEventos: config.WOMPI_SECRETO_EVENTOS,
  redirectUrl: config.WOMPI_URL_REDIRECCION
}, config.WOMPI_LLAVE_PRIVADA ? new ApiWompi(config.WOMPI_LLAVE_PRIVADA) : null, notificador);

const app = crearApp({
  servicio,
  pagos,
  cuentas,
  verificarSesion: db ? sesionSupabase(db) : sesionDesarrollo,
  verificarHumano: crearVerificadorTurnstile(config.TURNSTILE_SECRETO),
  origenes: config.CORS_ORIGENES.split(',').map((o) => o.trim()).filter(Boolean),
  // Aprobar compras sin pagar solo existe con datos simulados: con PlacApi real nunca,
  // aunque NODE_ENV quede mal configurado.
  rutasDesarrollo: !esProduccion && config.PLACAPI_MODO === 'simulado'
});

const servidor = app.listen(config.PORT, () => {
  logger.info('API lista', { puerto: config.PORT, placapi: config.PLACAPI_MODO, datos: db ? 'supabase' : 'memoria' });
});

// Mantenimiento: devuelve el saldo de consultas colgadas, concilia pagos con Wompi y borra los PDF vencidos.
const mantenimiento = setInterval(() => {
  pagos.conciliarPendientes().catch((e) => logger.error('conciliación fallida', { causa: String(e) }));
  servicio.recuperarColgadas().catch((e) => logger.error('recuperación fallida', { causa: String(e) }));
  servicio.limpiarVencidas().catch((e) => logger.error('limpieza fallida', { causa: String(e) }));
}, 10 * 60_000);

async function apagar(senal: string) {
  logger.info('apagando', { senal });
  clearInterval(mantenimiento);
  servidor.close();
  await servicio.esperarProcesos();
  await pdf.cerrar();
  process.exit(0);
}
process.on('SIGTERM', () => void apagar('SIGTERM'));
process.on('SIGINT', () => void apagar('SIGINT'));
