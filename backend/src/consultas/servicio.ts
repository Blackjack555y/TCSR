import { randomUUID } from 'node:crypto';
import type { AlmacenamientoPdf } from '../almacenamiento/local.js';
import type { RepositorioCuentas } from '../cuentas/repositorio.js';
import { armarInforme } from '../informe/armar.js';
import { logger } from '../logger.js';
import type { RenderizadorPdf } from '../pdf/render.js';
import { ErrorFuente, type FuenteVehicular } from '../placapi/index.js';
import { renderInformeHtml } from '../plantilla/informe-html.js';
import type { Hasher } from '../privacidad/hash.js';
import type { CodigoErrorSistema, Consulta } from './modelo.js';
import type { Notificador } from '../notificaciones/correo.js';
import { hoyColombia } from '../reglas/fechas.js';
import { obtenerDatosConCreditos, type EntradaInforme } from './orquestador.js';
import type { RepositorioConsultas } from './repositorio.js';

export interface Dependencias {
  repo: RepositorioConsultas;
  cuentas: RepositorioCuentas;
  fuente: FuenteVehicular;
  pdf: Pick<RenderizadorPdf, 'renderizar'>;
  almacenamiento: AlmacenamientoPdf;
  hash: Hasher;
  diasVigencia: number;
  ahora?: () => Date;
  notificador?: Notificador | null;
  /** Consultas fallidas por datos (cédula que no coincide, sin resultados) que se permiten por usuario en 24 h. 0 = sin límite. */
  limiteFallidasDia?: number;
  /** Créditos de PlacApi por día a partir de los cuales se registra una alerta. 0 = sin alerta. */
  alertaCreditosDia?: number;
}

export interface NuevaConsulta {
  usuarioId: string;
  entrada: EntradaInforme;
  consentimiento: { version: string };
  ip: string;
}

/** Una misma consulta del mismo usuario dentro de esta ventana no se paga dos veces. */
const VENTANA_REUSO_MS = 24 * 3_600_000;
/** Una consulta sin terminar después de este tiempo se da por perdida y se devuelve el saldo. */
const LIMITE_COLGADA_MS = 15 * 60_000;

/** Errores atribuibles a los datos que envió el usuario: cuentan para el límite diario. */
const CODIGOS_FALLIDA_POR_DATOS = ['documento_no_coincide', 'sin_resultados'] as const;

export class LimiteIntentosError extends Error {
  constructor(readonly limite: number) {
    super(`Límite de ${limite} consultas fallidas en 24 horas`);
    this.name = 'LimiteIntentosError';
  }
}

export class SinSaldoError extends Error {
  constructor(readonly tipo: string) {
    super(`Sin saldo para el informe ${tipo}`);
    this.name = 'SinSaldoError';
  }
}

export type ResultadoPdf =
  | { tipo: 'ok'; pdf: Buffer; nombre: string }
  | { tipo: 'no_existe' | 'no_listo' | 'vencido' };

export class ServicioConsultas {
  /** Procesos en curso, para poder esperarlos en pruebas y al apagar. */
  private readonly enCurso = new Map<string, Promise<void>>();
  /** Creaciones en curso por usuario y vehículo, para atenderlas en orden. */
  private readonly creando = new Map<string, Promise<unknown>>();
  private creditosHoy = { dia: '', total: 0, alertado: false };

  constructor(private readonly d: Dependencias) {}

  private ahora() {
    return this.d.ahora?.() ?? new Date();
  }

  private huella(e: EntradaInforme): string {
    const id = e.tipo === 'vin' ? e.vin : e.tipo === 'full' ? `${e.placa}:${e.docType}:${e.docNumber}` : e.placa;
    return this.d.hash(`${e.tipo}:${id}`);
  }

  async crear(n: NuevaConsulta): Promise<{ consulta: Consulta; reutilizada: boolean }> {
    // Dos pedidos iguales al mismo tiempo (doble clic, dos pestañas) se atienden uno tras otro:
    // el segundo encuentra la consulta del primero y no paga dos veces.
    const llave = `${n.usuarioId}:${this.huella(n.entrada)}`;
    const anterior = this.creando.get(llave) ?? Promise.resolve();
    const actual = anterior.catch(() => null).then(() => this.crearSinCompetencia(n));
    const cola = actual.catch(() => null).finally(() => {
      if (this.creando.get(llave) === cola) this.creando.delete(llave);
    });
    this.creando.set(llave, cola);
    return actual;
  }

  private async crearSinCompetencia(n: NuevaConsulta): Promise<{ consulta: Consulta; reutilizada: boolean }> {
    const { entrada: e, usuarioId } = n;
    const ahora = this.ahora();
    const huella = this.huella(e);
    const desde = new Date(ahora.getTime() - VENTANA_REUSO_MS).toISOString();

    const previa = await this.d.repo.buscarReciente(usuarioId, huella, desde);
    // Un informe parcial da derecho a un reintento gratis dentro de la ventana; el reintento no da otro.
    const reintentoDe = previa?.estado === 'completada' && previa.parcial && !previa.reintentoDe ? previa.id : undefined;
    if (previa && previa.estado !== 'error' && previa.estado !== 'vencida' && !reintentoDe) {
      return { consulta: previa, reutilizada: true };
    }

    // Cada fallida por datos nos puede costar créditos aunque al usuario se le devuelva el saldo.
    const limite = this.d.limiteFallidasDia ?? 0;
    if (limite > 0) {
      const fallidas = await this.d.repo.contarFallidas(usuarioId, new Date(ahora.getTime() - VENTANA_REUSO_MS).toISOString(), [...CODIGOS_FALLIDA_POR_DATOS]);
      if (fallidas >= limite) throw new LimiteIntentosError(limite);
    }

    // El saldo se descuenta antes de consultar; si algo falla, se devuelve. El reintento no descuenta.
    const id = randomUUID();
    if (!reintentoDe && !(await this.d.cuentas.consumirSaldo(usuarioId, e.tipo, id))) throw new SinSaldoError(e.tipo);

    const consulta: Consulta = {
      id,
      usuarioId,
      tipo: e.tipo,
      placa: e.tipo === 'vin' ? null : e.placa,
      vin: e.tipo === 'vin' ? e.vin : null,
      docType: e.tipo === 'full' ? e.docType : null,
      docHash: e.tipo === 'full' ? this.d.hash(`${e.docType}:${e.docNumber}`) : null,
      huella,
      estado: 'en_curso',
      creadaEn: ahora.toISOString(),
      actualizadaEn: ahora.toISOString(),
      consentimiento: { version: n.consentimiento.version, aceptadoEn: ahora.toISOString(), ipHash: this.d.hash(n.ip) },
      creditosEstimados: 0,
      ...(reintentoDe && { reintentoDe })
    };

    try {
      await this.d.repo.crear(consulta);
    } catch (err) {
      await this.d.cuentas.devolverSaldo(id);
      // Con varias instancias del backend, la base rechaza la consulta duplicada en curso:
      // se responde con la que ya está corriendo.
      const enCurso = await this.d.repo.buscarReciente(usuarioId, huella, desde).catch(() => null);
      if (enCurso && (enCurso.estado === 'en_curso' || enCurso.estado === 'generando_pdf')) {
        return { consulta: enCurso, reutilizada: true };
      }
      throw err;
    }

    // El documento en claro solo vive en memoria durante el proceso.
    const proceso = this.procesar(id, usuarioId, e).finally(() => this.enCurso.delete(id));
    this.enCurso.set(id, proceso);
    return { consulta, reutilizada: false };
  }

  private async procesar(id: string, usuarioId: string, entrada: EntradaInforme): Promise<void> {
    const inicio = performance.now();
    try {
      const { datos, creditos } = await obtenerDatosConCreditos(this.d.fuente, entrada);
      this.sumarCreditos(creditos);
      const informe = armarInforme(datos, { ahora: this.ahora(), diasVigencia: this.d.diasVigencia });
      await this.d.repo.actualizar(id, { estado: 'generando_pdf', informe, placa: datos.placa, parcial: informe.parcial, creditosEstimados: creditos });

      const pdf = await this.d.pdf.renderizar(renderInformeHtml(informe));
      const pdfClave = `${id}.pdf`;
      await this.d.almacenamiento.guardar(pdfClave, pdf);
      await this.d.repo.actualizar(id, { estado: 'completada', pdfClave, venceEn: informe.venceEn });

      logger.info('consulta completada', { id, tipo: entrada.tipo, conclusion: informe.conclusion.nivel, parcial: informe.parcial, creditos, ms: Math.round(performance.now() - inicio) });
      if (this.d.notificador) void this.d.notificador.informeListo(usuarioId, id, datos.placa, informe.venceEn);
    } catch (err) {
      const creditos = (err as { creditos?: number }).creditos ?? 0;
      if (creditos > 0) {
        this.sumarCreditos(creditos);
        await this.d.repo.actualizar(id, { creditosEstimados: creditos }).catch(() => null);
      }
      const { codigo, reintentable } = clasificarError(err);
      const log = codigo === 'servicio_no_disponible' || codigo === 'error_interno' ? logger.error : logger.warn;
      log('consulta fallida', { id, codigo, causa: err instanceof Error ? err.message : String(err) });
      await this.fallar(id, codigo, reintentable);
    }
  }

  /** Lleva el gasto del día y alerta una vez si pasa el umbral. */
  private sumarCreditos(n: number) {
    const dia = hoyColombia(this.ahora());
    if (this.creditosHoy.dia !== dia) this.creditosHoy = { dia, total: 0, alertado: false };
    this.creditosHoy.total += n;
    const umbral = this.d.alertaCreditosDia ?? 0;
    if (umbral > 0 && !this.creditosHoy.alertado && this.creditosHoy.total >= umbral) {
      this.creditosHoy.alertado = true;
      logger.error('gasto de créditos de PlacApi por encima del umbral diario', { dia, creditos: this.creditosHoy.total, umbral });
    }
  }

  private async fallar(id: string, codigo: CodigoErrorSistema, reintentable: boolean) {
    const devuelto = await this.d.cuentas.devolverSaldo(id);
    await this.d.repo.actualizar(id, { estado: 'error', error: { codigo, reintentable }, saldoDevuelto: devuelto });
  }

  async obtener(id: string, usuarioId: string): Promise<Consulta | null> {
    const c = await this.d.repo.obtener(id);
    // Una consulta ajena se responde igual que una inexistente.
    if (!c || c.usuarioId !== usuarioId) return null;
    return this.conVencimiento(c);
  }

  private conVencimiento(c: Consulta): Consulta {
    return c.estado === 'completada' && c.venceEn && c.venceEn < this.ahora().toISOString() ? { ...c, estado: 'vencida' } : c;
  }

  async historial(usuarioId: string, limite = 50): Promise<Consulta[]> {
    const lista = await this.d.repo.listarDeUsuario(usuarioId, limite);
    return lista.map((c) => this.conVencimiento(c));
  }

  async leerPdf(id: string, usuarioId: string): Promise<ResultadoPdf> {
    const c = await this.obtener(id, usuarioId);
    if (!c) return { tipo: 'no_existe' };
    if (c.estado === 'vencida') return { tipo: 'vencido' };
    if (c.estado !== 'completada' || !c.pdfClave) return { tipo: 'no_listo' };
    const pdf = await this.d.almacenamiento.leer(c.pdfClave);
    return pdf ? { tipo: 'ok', pdf, nombre: `informe-${c.placa ?? c.id}.pdf` } : { tipo: 'vencido' };
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

  /** Cierra las consultas que un reinicio dejó a medias y devuelve el saldo. */
  async recuperarColgadas(): Promise<number> {
    const antes = new Date(this.ahora().getTime() - LIMITE_COLGADA_MS).toISOString();
    const colgadas = (await this.d.repo.listarColgadas(antes)).filter((c) => !this.enCurso.has(c.id));
    for (const c of colgadas) await this.fallar(c.id, 'error_interno', true);
    if (colgadas.length > 0) logger.warn('consultas colgadas recuperadas', { cantidad: colgadas.length });
    return colgadas.length;
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
