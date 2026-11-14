import type { Bloque, DatosConsulta, EstadoConsulta, Hallazgo, IdVerificacion, Verificacion } from '../dominio/tipos.js';
import { reglaAvaluo, reglaHistorial, reglaHurto, reglaImpuestos, reglaMultas, reglaPrendasDetalle, reglaSiniestros } from './complementarias.js';
import {
  reglaDesintegracion, reglaDian, reglaEstadoMatricula, reglaGravamenes, reglaPrendas,
  reglaRegrabados, reglaRtm, reglaSoat, type Contexto, type Resultado
} from './runt.js';

/** Cambia cada vez que una regla cambia su resultado. Queda guardada en cada informe. */
export const VERSION_REGLAS = '2026.11.2';

const NOMBRES: Record<IdVerificacion, { nombre: string; fuente: string }> = {
  estado_matricula: { nombre: 'Estado de la matrícula', fuente: 'RUNT' },
  soat: { nombre: 'SOAT', fuente: 'RUNT' },
  rtm: { nombre: 'Revisión técnico-mecánica', fuente: 'RUNT' },
  gravamenes: { nombre: 'Embargos y limitaciones', fuente: 'RUNT' },
  prendas: { nombre: 'Prendas', fuente: 'RUNT / Confecámaras' },
  regrabados: { nombre: 'Regrabado de motor, chasis o VIN', fuente: 'RUNT' },
  desintegracion: { nombre: 'Desintegración', fuente: 'RUNT' },
  validacion_dian: { nombre: 'Validación DIAN', fuente: 'RUNT' },
  multas: { nombre: 'Multas y comparendos', fuente: 'SIMIT' },
  impuestos: { nombre: 'Impuesto vehicular', fuente: 'Secretarías de Hacienda' },
  propietarios: { nombre: 'Historial de propietarios', fuente: 'RUNT' },
  hurto: { nombre: 'Reportes de hurto', fuente: 'Registros judiciales' },
  siniestros: { nombre: 'Reclamaciones a aseguradoras', fuente: 'FASECOLDA' },
  avaluo: { nombre: 'Valor de referencia', fuente: 'FASECOLDA' },
  antecedentes_propietario: { nombre: 'Antecedentes del propietario', fuente: '—' }
};

function noDisponible(id: IdVerificacion, consulta: Exclude<EstadoConsulta, 'ok'>, consultadoEn: string | null = null): Resultado {
  const { nombre, fuente } = NOMBRES[id];
  return { verificacion: { id, nombre, fuente, consulta, valor: null, nivel: 'no_disponible', consultadoEn }, hallazgos: [] };
}

/** Si el bloque no trae datos, la verificación es "no disponible", nunca "sin hallazgos". */
function segun<T>(id: IdVerificacion, b: Bloque<T>, regla: (datos: T, base: { id: IdVerificacion; nombre: string; fuente: string; consultadoEn: string | null }) => Resultado): Resultado {
  if (b.estado !== 'ok') return noDisponible(id, b.estado, b.consultadoEn ?? null);
  return regla(b.datos, { id, ...NOMBRES[id], consultadoEn: b.consultadoEn });
}

export interface Evaluacion {
  verificaciones: Verificacion[];
  hallazgos: Hallazgo[];
}

export function evaluar(d: DatosConsulta, hoy: string): Evaluacion {
  const resultados: Resultado[] = [];
  const v = d.vehiculo;

  if (v.estado === 'ok') {
    const ctx: Contexto = { hoy, consultadoEn: v.consultadoEn };
    resultados.push(reglaEstadoMatricula(v.datos, ctx));
    resultados.push(d.soatDisponible ? reglaSoat(v.datos, ctx) : noDisponible('soat', 'error'));
    resultados.push(d.rtmDisponible ? reglaRtm(v.datos, ctx) : noDisponible('rtm', 'error'));
    resultados.push(d.legalDisponible ? reglaGravamenes(v.datos, ctx) : noDisponible('gravamenes', 'error'));
    resultados.push(d.prendas.estado === 'no_consultada'
      ? (d.legalDisponible ? reglaPrendas(v.datos, ctx) : noDisponible('prendas', 'error'))
      : segun('prendas', d.prendas, reglaPrendasDetalle));
    resultados.push(reglaRegrabados(v.datos, ctx), reglaDesintegracion(v.datos, ctx));
    const dian = reglaDian(v.datos, ctx);
    if (dian) resultados.push(dian);
  } else {
    for (const id of ['estado_matricula', 'soat', 'rtm', 'gravamenes', 'regrabados', 'desintegracion'] as const) {
      resultados.push(noDisponible(id, v.estado, v.consultadoEn ?? null));
    }
    resultados.push(segun('prendas', d.prendas, reglaPrendasDetalle));
  }

  resultados.push(
    segun('multas', d.multas, reglaMultas),
    segun('impuestos', d.impuestos, reglaImpuestos),
    segun('propietarios', d.historial, (x, b) => reglaHistorial(x, b, hoy)),
    segun('hurto', d.hurto, reglaHurto),
    segun('siniestros', d.siniestros, reglaSiniestros),
    segun('avaluo', d.avaluo, reglaAvaluo),
    // No se consulta hasta tener la validación legal. Nunca se omite.
    noDisponible('antecedentes_propietario', 'no_consultada')
  );

  return {
    verificaciones: resultados.map((r) => r.verificacion),
    hallazgos: resultados.flatMap((r) => r.hallazgos)
  };
}
