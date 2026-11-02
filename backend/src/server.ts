import { AlmacenamientoLocal } from './almacenamiento/local.js';
import { crearApp } from './api/app.js';
import { crearVerificadorTurnstile } from './api/turnstile.js';
import { cargarConfig } from './config.js';
import { RepositorioMemoria } from './consultas/repositorio.js';
import { ServicioConsultas } from './consultas/servicio.js';
import { logger } from './logger.js';
import { RenderizadorPdf } from './pdf/render.js';
import { crearFuente } from './placapi/index.js';
import { crearHasher } from './privacidad/hash.js';

const config = cargarConfig();
const pdf = new RenderizadorPdf(config.CHROME_PATH);

// TODO: reemplazar memoria y disco local por Supabase (tablas en db/migraciones, bucket privado).
const servicio = new ServicioConsultas({
  repo: new RepositorioMemoria(),
  fuente: crearFuente(config),
  pdf,
  almacenamiento: new AlmacenamientoLocal(config.ALMACENAMIENTO_DIR),
  hash: crearHasher(config.DOC_HASH_SECRETO),
  diasVigencia: config.PDF_DIAS_VIGENCIA
});

const app = crearApp({
  servicio,
  verificarHumano: crearVerificadorTurnstile(config.TURNSTILE_SECRETO),
  origenes: config.CORS_ORIGENES.split(',').map((o) => o.trim()).filter(Boolean)
});

const servidor = app.listen(config.PORT, () => {
  logger.info('API lista', { puerto: config.PORT, placapi: config.PLACAPI_MODO });
});

// Borra los PDF vencidos cada hora.
const limpieza = setInterval(() => {
  servicio.limpiarVencidas().catch((e) => logger.error('limpieza fallida', { causa: String(e) }));
}, 3_600_000);

async function apagar(senal: string) {
  logger.info('apagando', { senal });
  clearInterval(limpieza);
  servidor.close();
  await servicio.esperarProcesos();
  await pdf.cerrar();
  process.exit(0);
}
process.on('SIGTERM', () => void apagar('SIGTERM'));
process.on('SIGINT', () => void apagar('SIGINT'));
