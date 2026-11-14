import { readFile } from 'node:fs/promises';
import { ErrorFuente } from './errores.js';
import type { FuenteVehicular, ParametrosFull, RawAccidentes, RawAvaluo, RawConsultaRunt, RawFull, RawGarantias, RawHurto, RawSiniestros, RespuestaBloque } from './tipos.js';

const leer = async <T>(archivo: string): Promise<T> => {
  const j = JSON.parse(await readFile(new URL(`../../fixtures/${archivo}`, import.meta.url), 'utf8')) as T & { _nota?: string };
  delete j._nota;
  return j;
};

const ahora = () => new Date().toISOString();

/**
 * Fuente simulada para desarrollo y pruebas: no gasta créditos.
 * Documentos que simulan errores en Full: 0000000404 (sin resultados),
 * 0000000409 (no coincide con el propietario), 0000000502 (fuente caída).
 * VIN terminado en 00404 simula "sin resultados". La placa ALE123 trae hurto activo,
 * pérdida total, prenda y un accidente con heridos en Bogotá. FAL123 hace fallar el reporte de hurto (informe parcial).
 */
export class FuenteSimulada implements FuenteVehicular {
  constructor(private readonly demoraMs = 1500) {}

  private esperar() {
    return new Promise((r) => setTimeout(r, this.demoraMs));
  }

  async consultaFull(p: ParametrosFull): Promise<RawFull> {
    await this.esperar();
    if (p.docNumber === '0000000404') throw new ErrorFuente('sin_resultados', 404, 'vehiculo_no_registrado');
    if (p.docNumber === '0000000409') throw new ErrorFuente('documento_no_coincide', 404, 'propietario_no_coincide');
    if (p.docNumber === '0000000502') throw new ErrorFuente('fuente_caida', 502, 'source_error');
    const raw = await leer<RawFull>('full-ejemplo.json');
    if (raw.vehicle?.data) raw.vehicle.data.placa = p.placa;
    return raw;
  }

  async consultaPorVin(vin: string): Promise<RawConsultaRunt> {
    await this.esperar();
    if (vin.endsWith('00404')) throw new ErrorFuente('sin_resultados', 404, 'vehiculo_no_registrado');
    const raw = await leer<RawConsultaRunt>('runt-consulta-abc12d.json');
    raw.fetchedAt = ahora();
    return raw;
  }

  async avaluoPorVin(): Promise<RespuestaBloque<RawAvaluo>> {
    return leer('avaluo-ejemplo.json');
  }

  async reporteHurto(placa: string): Promise<RespuestaBloque<RawHurto>> {
    if (placa === 'FAL123') throw new ErrorFuente('fuente_caida', 502, 'source_error');
    if (placa === 'ALE123') return leer('hurto-alerta.json');
    return { status: 'ok', fetchedAt: ahora(), data: { reportadoHurto: false, denunciaHurtoActiva: false, totalRegistros: 0, registros: [], extincionDominio: [] } };
  }

  async perdidaTotal(placa: string): Promise<RespuestaBloque<RawSiniestros>> {
    if (placa === 'ALE123') return leer('siniestros-alerta.json');
    return { status: 'ok', fetchedAt: ahora(), data: { perdidaTotal: false, totalSiniestros: 0, siniestros: [] } };
  }

  async garantiasRgm(placa: string): Promise<RespuestaBloque<RawGarantias>> {
    if (placa === 'ALE123') return leer('garantias-alerta.json');
    return { status: 'ok', fetchedAt: ahora(), data: { tienePrenda: false, garantias: [] } };
  }

  async accidentesBogota(placa: string): Promise<RespuestaBloque<RawAccidentes>> {
    if (placa === 'ALE123') {
      return { status: 'danger', fetchedAt: ahora(), data: { totalAccidentes: 1, gravedadMaxima: 'con_heridos', accidentes: [{ fecha: '2023-05-20', gravedad: 'CON HERIDOS' }] } };
    }
    return { status: 'ok', fetchedAt: ahora(), data: { totalAccidentes: 0, gravedadMaxima: null, accidentes: [] } };
  }
}
