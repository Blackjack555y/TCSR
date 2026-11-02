import { randomUUID } from 'node:crypto';
import type { AlmacenamientoPdf } from '../almacenamiento/local.js';
import { armarInforme } from '../informe/armar.js';
import { logger } from '../logger.js';
import { normalizarRunt } from '../normalizacion/runt.js';
import type { RenderizadorPdf } from '../pdf/render.js';
import { ErrorFuente, type FuenteVehicular, type ParametrosConsulta } from '../placapi/index.js';
import { renderInformeHtml } from '../plantilla/informe-html.js';
import type { Hasher } from '../privacidad/hash.js';
import type { CodigoErrorSistema, Consulta } from './modelo.js';
import type { RepositorioConsultas } from './repositorio.js';

export interface Dependencias {
  repo: RepositorioConsultas;
  fuente: FuenteVehicular;
  pdf: Pick<RenderizadorPdf, 'renderizar'>;
  almacenamiento: AlmacenamientoPdf;
  hash: Hasher;
  diasVigencia: number;
  ahora?: () => Date;
}

export interface NuevaConsulta extends ParametrosConsulta {
  consentimiento: { version: string };
  ip: string;
}

/** Créditos de PlacApi por informe en esta versión (/consulta). */
const CREDITOS_POR_INFORME = 1;
/** Una misma placa + documento dentro de esta ventana reutiliza la consulta: no se paga dos veces. */
const VENTANA_REUSO_MS = 24 * 3_600_000;

export type ResultadoPdf =
  | { tipo: 'ok'; pdf: Buffer; placa: string }
  | { tipo: 'no_existe' | 'no_listo' | 'vencido' };

export class ServicioConsultas {
  /** Procesos en curso, para poder esperarlos en pruebas y al apagar. */
  private readonly enCurso = new Map<string, Promise<void>>();

  constructor(private readonly d: Dependencias) {}

  private ahora() {
    return this.d.ahora?.() ?? new Date();
  }

  async crear(n: NuevaConsulta): Promise<{ consulta: Consulta; reutilizada: boolean }> {
    const docHash = this.d.hash(`${n.docType}:${n.docNumber}`);
    const ahora = this.ahora();

    const previa = await this.d.repo.buscarReciente(n.placa, docHash, new Date(ahora.getTime() - VENTANA_REUSO_MS).toISOString());
    if (previa && previa.estado !== 'error' && previa.estado !== 'vencida') {
      return { consulta: previa, reutilizada: true };
    }

    const consulta: Consulta = {
      id: randomUUID(),
      placa: n.placa,
      docType: n.docType,
      docHash,
      estado: 'en_curso',
      creadaEn: ahora.toISOString(),
      actualizadaEn: ahora.toISOString(),
      consentimiento: { version: n.consentimiento.version, aceptadoEn: ahora.toISOString(), ipHash: this.d.hash(n.ip) }
    };
    await this.d.repo.crear(consulta);

    // El documento en claro solo vive en memoria durante el proceso.
    const proceso = this.procesar(consulta.id, { placa: n.placa, docType: n.docType, docNumber: n.docNumber })
      .finally(() => this.enCurso.delete(consulta.id));
    this.enCurso.set(consulta.id, proceso);

    return { consulta, reutilizada: false };
  }

  private async procesar(id: string, params: ParametrosConsulta): Promise<void> {
    const inicio = performance.now();
    try {
      const raw = await this.d.fuente.consultarRunt(params);
      const vehiculo = normalizarRunt(raw);
      const informe = armarInforme(vehiculo, {
        ahora: this.ahora(),
        consultadoEn: raw.fetchedAt ?? null,
        diasVigencia: this.d.diasVigencia
      });
      await this.d.repo.actualizar(id, { estado: 'generando_pdf', informe, creditosEstimados: CREDITOS_POR_INFORME });

      const pdf = await this.d.pdf.renderizar(renderInformeHtml(informe));
      const pdfClave = `${id}.pdf`;
      await this.d.almacenamiento.guardar(pdfClave, pdf);
      await this.d.repo.actualizar(id, { estado: 'completada', pdfClave, venceEn: informe.venceEn });

      logger.info('consulta completada', { id, conclusion: informe.conclusion.nivel, ms: Math.round(performance.now() - inicio) });
    } catch (err) {
      const { codigo, reintentable } = clasificarError(err);
      const log = codigo === 'servicio_no_disponible' || codigo === 'error_interno' ? logger.error : logger.warn;
      log('consulta fallida', {
        id, codigo,
        causa: err instanceof ErrorFuente ? err.message : err instanceof Error ? err.message : String(err)
      });
      await this.d.repo.actualizar(id, { estado: 'error', error: { codigo, reintentable } });
    }
  }

  async obtener(id: string): Promise<Consulta | null> {
    const c = await this.d.repo.obtener(id);
    if (c?.estado === 'completada' && c.venceEn && c.venceEn < this.ahora().toISOString()) {
      return { ...c, estado: 'vencida' };
    }
    return c;
  }

  async leerPdf(id: string): Promise<ResultadoPdf> {
    const c = await this.obtener(id);
    if (!c) return { tipo: 'no_existe' };
    if (c.estado === 'vencida') return { tipo: 'vencido' };
    if (c.estado !== 'completada' || !c.pdfClave) return { tipo: 'no_listo' };
    const pdf = await this.d.almacenamiento.leer(c.pdfClave);
    return pdf ? { tipo: 'ok', pdf, placa: c.placa } : { tipo: 'vencido' };
  }

  /** Borra los PDF y el informe de las consultas vencidas. Deja solo el registro mínimo. */
  async limpiarVencidas(): Promise<number> {
    const vencidas = await this.d.repo.listarVencidas(this.ahora().toISOString());
    for (const c of vencidas) {
      await this.d.almacenamiento.borrar(c.pdfClave!);
      await this.d.repo.actualizar(c.id, { estado: 'vencida', pdfClave: undefined, informe: undefined });
    }
    if (vencidas.length > 0) logger.info('PDF vencidos borrados', { cantidad: vencidas.length });
    return vencidas.length;
  }

  /** Espera a que terminen los procesos en curso (pruebas y apagado ordenado). */
  async esperarProcesos(): Promise<void> {
    await Promise.allSettled([...this.enCurso.values()]);
  }
}

function clasificarError(err: unknown): { codigo: CodigoErrorSistema; reintentable: boolean } {
  if (!(err instanceof ErrorFuente)) return { codigo: 'error_interno', reintentable: true };
  switch (err.codigo) {
    case 'documento_no_coincide': return { codigo: 'documento_no_coincide', reintentable: true };
    case 'sin_resultados': return { codigo: 'sin_resultados', reintentable: true };
    case 'fuente_caida':
    case 'limite_peticiones': return { codigo: 'fuente_caida', reintentable: true };
    // Problemas nuestros (sin créditos, API key inválida, petición mal armada): no culpar al usuario.
    case 'sin_creditos':
    case 'no_autorizado':
    case 'datos_invalidos': return { codigo: 'servicio_no_disponible', reintentable: false };
    default: return { codigo: 'error_interno', reintentable: true };
  }
}
