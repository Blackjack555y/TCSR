import { randomBytes, randomUUID } from 'node:crypto';
import type { Conclusion, FilaEvidencia, Hallazgo, Informe, Verificacion, VehiculoRunt } from '../dominio/tipos.js';
import { evaluar, VERSION_REGLAS } from '../reglas/index.js';
import { fechaCorta, hoyColombia, sumarDias } from '../reglas/fechas.js';

export const VERSION_PLANTILLA = '2026.10.1';

export interface OpcionesInforme {
  ahora?: Date;
  /** Momento ISO en que la fuente entregó los datos. */
  consultadoEn: string | null;
  diasVigencia: number;
}

/** Código corto para verificar un informe impreso: CSR-XXXX-XXXX (sin caracteres ambiguos). */
export function codigoVerificacion(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(8);
  const c = Array.from(b, (x) => alfabeto[x % alfabeto.length]).join('');
  return `CSR-${c.slice(0, 4)}-${c.slice(4)}`;
}

export function armarInforme(vehiculo: VehiculoRunt, op: OpcionesInforme): Informe {
  const ahora = op.ahora ?? new Date();
  const hoy = hoyColombia(ahora);
  const { verificaciones, hallazgos } = evaluar(vehiculo, { hoy, consultadoEn: op.consultadoEn });

  // Alertas primero, después lo que requiere revisión.
  const ordenados = [...hallazgos].sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'alerta' ? -1 : 1));

  return {
    id: randomUUID(),
    codigoVerificacion: codigoVerificacion(),
    versiones: { reglas: VERSION_REGLAS, plantilla: VERSION_PLANTILLA },
    generadoEn: ahora.toISOString(),
    // Fin del día N en Colombia, guardado en UTC para poder comparar fechas.
    venceEn: new Date(`${sumarDias(hoy, op.diasVigencia)}T23:59:59-05:00`).toISOString(),
    vehiculo: {
      placa: vehiculo.placa,
      descripcion: describir(vehiculo),
      ficha: ficha(vehiculo)
    },
    conclusion: concluir(verificaciones),
    verificaciones,
    hallazgos: ordenados,
    proximosPasos: proximosPasos(ordenados, verificaciones),
    metodologia: metodologia(op.consultadoEn),
    evidencia: {
      soat: [...vehiculo.soat].sort((a, b) => (b.desde ?? '').localeCompare(a.desde ?? '')),
      rtm: [...vehiculo.rtm].sort((a, b) => (b.desde ?? '').localeCompare(a.desde ?? ''))
    }
  };
}

// ---------------------------------------------------------------------------

export function concluir(verificaciones: Verificacion[]): Conclusion {
  const alertas = verificaciones.filter((v) => v.nivel === 'alerta').length;
  const revisiones = verificaciones.filter((v) => v.nivel === 'revision').length;
  const noDisponibles = verificaciones.filter((v) => v.nivel === 'no_disponible').length;
  const aspectosAtencion = alertas + revisiones;

  // Nunca "listo para traspaso" ni "compra recomendada": el informe ayuda a decidir, no certifica.
  if (alertas > 0) {
    return {
      nivel: 'atencion_prioritaria', aspectosAtencion, noDisponibles,
      titulo: 'Atención prioritaria',
      descripcion: 'Encontramos alertas que debes resolver antes de continuar con la compra. Revisa cada hallazgo y sus próximos pasos.'
    };
  }
  if (revisiones > 0) {
    return {
      nivel: 'revision_recomendada', aspectosAtencion, noDisponibles,
      titulo: 'Revisión recomendada',
      descripcion: noDisponibles > 0
        ? 'No encontramos alertas críticas en las fuentes consultadas, pero hay puntos que debes revisar y verificaciones no disponibles antes de continuar.'
        : 'No encontramos alertas críticas, pero hay puntos que debes revisar antes de continuar.'
    };
  }
  if (noDisponibles > 0) {
    return {
      nivel: 'con_observaciones', aspectosAtencion, noDisponibles,
      titulo: 'Revisión completada con observaciones',
      descripcion: 'No encontramos alertas en las fuentes consultadas, pero hay verificaciones que no pudimos hacer. Revísalas antes de continuar.'
    };
  }
  return {
    nivel: 'sin_alertas', aspectosAtencion, noDisponibles,
    titulo: 'Sin alertas relevantes',
    descripcion: 'No encontramos alertas en las verificaciones realizadas. Esto no es una certificación oficial ni garantiza el traspaso.'
  };
}

function proximosPasos(hallazgos: Hallazgo[], verificaciones: Verificacion[]): string[] {
  const pasos = new Set(hallazgos.map((h) => h.queHacer));
  const noDisponible = (id: Verificacion['id']) => verificaciones.some((v) => v.id === id && v.nivel === 'no_disponible');

  if (noDisponible('multas')) {
    pasos.add('Consulta en el SIMIT las multas del vehículo y del vendedor: para el traspaso, ambos deben estar a paz y salvo.');
  }
  pasos.add('Compara los números de motor, chasis y VIN del vehículo con los de este informe y los de la licencia de tránsito.');
  pasos.add('Revisa el vehículo con un mecánico de confianza o un peritaje: este informe no evalúa su estado mecánico.');
  return [...pasos];
}

function metodologia(consultadoEn: string | null): string[] {
  const fecha = consultadoEn ? fechaCorta(consultadoEn.slice(0, 10)) : 'la fecha indicada';
  return [
    `Este informe reúne la información de las fuentes consultadas el ${fecha}. Los registros pueden cambiar después de esa fecha.`,
    '"Sin hallazgos" significa que la fuente respondió y no encontramos información adversa. No es una certificación oficial ni garantiza que el traspaso se pueda realizar.',
    '"No disponible" significa que no tuvimos acceso a ese dato: la fuente no está integrada, no respondió o no publica esa información para este vehículo. No significa que no exista un problema.',
    'Carro Sin Rollos no es el RUNT ni una entidad del Estado. Consultamos registros públicos a través de proveedores de datos y organizamos la información para ayudarte a decidir.',
    'Este informe no evalúa el estado mecánico, la carrocería ni el kilometraje del vehículo.'
  ];
}

function describir(v: VehiculoRunt): string {
  return [[v.marca, v.linea].filter(Boolean).join(' '), v.modelo && `Modelo ${v.modelo}`, v.clase && capital(v.clase)]
    .filter(Boolean)
    .join(' · ');
}

function ficha(v: VehiculoRunt): FilaEvidencia[] {
  const filas: [string, string | number | null][] = [
    ['Placa', v.placa],
    ['Marca', v.marca],
    ['Línea', v.linea],
    ['Modelo', v.modelo],
    ['Clase', v.clase && capital(v.clase)],
    ['Servicio', v.servicio],
    ['Color', v.color && capital(v.color)],
    ['Cilindraje', v.cilindraje && `${v.cilindraje} cc`],
    ['Combustible', v.combustible && capital(v.combustible)],
    ['Fecha de matrícula', v.fechaMatricula && fechaCorta(v.fechaMatricula)],
    ['Organismo de tránsito', v.organismoTransito && capital(v.organismoTransito)],
    ['VIN', v.vin],
    ['Número de motor', v.numeroMotor],
    ['Número de chasis', v.numeroChasis]
  ];
  return filas.map(([etiqueta, valor]) => ({ etiqueta, valor: valor == null || valor === '' ? '—' : String(valor) }));
}

const capital = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());
