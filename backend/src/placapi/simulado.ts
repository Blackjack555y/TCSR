import { readFile } from 'node:fs/promises';
import { ErrorFuente } from './errores.js';
import type { FuenteVehicular, ParametrosConsulta, RawConsultaRunt } from './tipos.js';

const FIXTURE = new URL('../../fixtures/runt-consulta-abc12d.json', import.meta.url);

/**
 * Fuente simulada para desarrollo y pruebas: no gasta créditos.
 * Cualquier placa devuelve la moto de ejemplo, salvo estos documentos que simulan errores:
 *   0000000404 → sin resultados
 *   0000000409 → el documento no coincide con el propietario
 *   0000000502 → la fuente no responde
 */
export class FuenteSimulada implements FuenteVehicular {
  constructor(private readonly demoraMs = 1500) {}

  async consultarRunt(p: ParametrosConsulta): Promise<RawConsultaRunt> {
    await new Promise((r) => setTimeout(r, this.demoraMs));

    if (p.docNumber === '0000000404') throw new ErrorFuente('sin_resultados', 404, 'vehiculo_no_registrado');
    if (p.docNumber === '0000000409') throw new ErrorFuente('documento_no_coincide', 404, 'propietario_no_coincide');
    if (p.docNumber === '0000000502') throw new ErrorFuente('fuente_caida', 502, 'source_error');

    const raw = JSON.parse(await readFile(FIXTURE, 'utf8')) as RawConsultaRunt & { _nota?: string };
    delete raw._nota;
    // La placa consultada reemplaza la del ejemplo para que el informe sea coherente.
    if (raw.data) {
      raw.data.plate = p.placa;
      if (raw.data.informacionGeneral) raw.data.informacionGeneral.noPlaca = p.placa;
    }
    raw.fetchedAt = new Date().toISOString();
    return raw;
  }
}
