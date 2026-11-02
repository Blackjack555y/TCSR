import type { Hallazgo, IdVerificacion, Verificacion, VehiculoRunt } from '../dominio/tipos.js';
import {
  reglaDesintegracion, reglaDian, reglaEstadoMatricula, reglaGravamenes, reglaPrendas,
  reglaRegrabados, reglaRtm, reglaSoat, type Contexto, type Resultado
} from './runt.js';

/** Cambia cada vez que una regla cambia su resultado. Queda guardada en cada informe. */
export const VERSION_REGLAS = '2026.10.1';

/**
 * Verificaciones que el informe siempre muestra aunque esta versión no las consulte.
 * Aparecen como "No disponible", nunca se omiten ni se muestran como "sin hallazgos".
 */
const NO_INTEGRADAS: { id: IdVerificacion; nombre: string; fuente: string }[] = [
  { id: 'multas', nombre: 'Multas y comparendos', fuente: 'SIMIT' },
  { id: 'impuestos', nombre: 'Impuesto vehicular', fuente: 'Secretarías de Hacienda' },
  { id: 'propietarios', nombre: 'Historial de traspasos', fuente: 'RUNT' },
  { id: 'hurto', nombre: 'Reportes de hurto', fuente: 'Fiscalía / Policía' },
  { id: 'siniestros', nombre: 'Reclamaciones a aseguradoras', fuente: 'FASECOLDA' },
  { id: 'antecedentes_propietario', nombre: 'Antecedentes del propietario', fuente: '—' }
];

export interface Evaluacion {
  verificaciones: Verificacion[];
  hallazgos: Hallazgo[];
}

export function evaluar(vehiculo: VehiculoRunt, ctx: Contexto): Evaluacion {
  const resultados: Resultado[] = [
    reglaEstadoMatricula(vehiculo, ctx),
    reglaSoat(vehiculo, ctx),
    reglaRtm(vehiculo, ctx),
    reglaGravamenes(vehiculo, ctx),
    reglaPrendas(vehiculo, ctx),
    reglaRegrabados(vehiculo, ctx),
    reglaDesintegracion(vehiculo, ctx),
    reglaDian(vehiculo, ctx)
  ].filter((r): r is Resultado => r !== null);

  const noIntegradas: Verificacion[] = NO_INTEGRADAS.map((n) => ({
    id: n.id,
    nombre: n.nombre,
    consulta: 'no_consultada',
    valor: null,
    nivel: 'no_disponible',
    fuente: n.fuente,
    consultadoEn: null
  }));

  return {
    verificaciones: [...resultados.map((r) => r.verificacion), ...noIntegradas],
    hallazgos: resultados.flatMap((r) => r.hallazgos)
  };
}

export type { Contexto } from './runt.js';
