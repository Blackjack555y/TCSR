import type { Hallazgo, IdVerificacion, Nivel, Verificacion, VehiculoRunt } from '../dominio/tipos.js';
import { duracion, fechaCorta, mesAnio, sumarAnios } from './fechas.js';
import { analizarVigencias, UMBRAL_POR_VENCER_DIAS, type Hueco } from './vigencias.js';

export interface Contexto {
  /** Fecha de la consulta en Colombia (yyyy-mm-dd). Todas las reglas de vencimiento dependen de ella. */
  hoy: string;
  /** Momento ISO en que la fuente entregó los datos. */
  consultadoEn: string | null;
}

export interface Resultado {
  verificacion: Verificacion;
  hallazgos: Hallazgo[];
}

const FUENTE = 'RUNT';

// Textos compartidos entre SOAT y RTM: iguales a propósito, para que los próximos pasos no se repitan.
const RENOVAR_PRONTO = 'Ten en cuenta la renovación del SOAT y la revisión técnico-mecánica al negociar el precio, o pide al vendedor que las renueve antes del traspaso.';
const PREGUNTAR_HUECO = 'Pregúntale al vendedor por los periodos sin SOAT o sin revisión: si el vehículo circuló, revisa los comparendos de esas fechas.';

const PRIORIDAD: Record<Nivel, number> = { sin_hallazgos: 0, no_disponible: 1, revision: 2, alerta: 3 };
export const peorNivel = (...n: Nivel[]): Nivel => n.reduce((a, b) => (PRIORIDAD[b] > PRIORIDAD[a] ? b : a));

function verificacion(ctx: Contexto, id: IdVerificacion, nombre: string, nivel: Nivel, valor: string | null): Verificacion {
  return {
    id, nombre, nivel, valor,
    consulta: nivel === 'no_disponible' ? 'no_cubierta' : 'ok',
    fuente: FUENTE,
    consultadoEn: ctx.consultadoEn
  };
}

function hallazgo(ctx: Contexto, id: IdVerificacion, nivel: 'revision' | 'alerta', textos: Pick<Hallazgo, 'titulo' | 'queEncontramos' | 'queSignifica' | 'queHacer'>): Hallazgo {
  return { verificacion: id, nivel, ...textos, fuente: FUENTE, consultadoEn: ctx.consultadoEn };
}

const listaHuecos = (huecos: Hueco[]) =>
  huecos.map((h) => `entre ${mesAnio(h.desde)} y ${mesAnio(h.hasta)} (${duracion(h.dias)})`).join('; ');

// ---------------------------------------------------------------------------

export function reglaEstadoMatricula(v: VehiculoRunt, ctx: Contexto): Resultado {
  const id = 'estado_matricula';
  const nombre = 'Estado de la matrícula';
  if (!v.estado) return { verificacion: verificacion(ctx, id, nombre, 'no_disponible', null), hallazgos: [] };
  if (v.estado.toUpperCase() === 'ACTIVO') {
    return { verificacion: verificacion(ctx, id, nombre, 'sin_hallazgos', 'Activa'), hallazgos: [] };
  }
  return {
    verificacion: verificacion(ctx, id, nombre, 'alerta', v.estado),
    hallazgos: [hallazgo(ctx, id, 'alerta', {
      titulo: 'La matrícula no está activa',
      queEncontramos: `El RUNT reporta la matrícula en estado "${v.estado}".`,
      queSignifica: 'Con la matrícula en ese estado, el traspaso puede no ser posible o el vehículo no puede circular.',
      queHacer: `Pide al vendedor que aclare el estado con ${v.organismoTransito ?? 'el organismo de tránsito'} antes de hacer cualquier pago.`
    })]
  };
}

export function reglaSoat(v: VehiculoRunt, ctx: Contexto): Resultado {
  const id = 'soat';
  const nombre = 'SOAT';
  const a = analizarVigencias(v.soat, ctx.hoy);
  const hallazgos: Hallazgo[] = [];
  let nivel: Nivel;
  let valor: string;

  if (a.registros.length === 0) {
    nivel = 'alerta';
    valor = 'Sin SOAT registrado';
    hallazgos.push(hallazgo(ctx, id, 'alerta', {
      titulo: 'No hay SOAT registrado',
      queEncontramos: 'El RUNT no tiene pólizas de SOAT registradas para este vehículo.',
      queSignifica: 'Circular sin SOAT es una infracción, y el vehículo no tendría cobertura en caso de accidente.',
      queHacer: 'Pide al vendedor la póliza vigente y verifícala con la aseguradora antes de comprar.'
    }));
  } else if (!a.actual) {
    nivel = 'alerta';
    valor = `Vencido desde el ${fechaCorta(a.ultimoVencimiento)}`;
    hallazgos.push(hallazgo(ctx, id, 'alerta', {
      titulo: 'El SOAT está vencido',
      queEncontramos: `El último SOAT registrado venció el ${fechaCorta(a.ultimoVencimiento)}.`,
      queSignifica: 'El vehículo no puede circular legalmente hasta que se expida un SOAT nuevo.',
      queHacer: 'Acuerda con el vendedor quién paga el SOAT nuevo antes de cerrar el negocio.'
    }));
  } else if (a.diasParaVencer! <= UMBRAL_POR_VENCER_DIAS) {
    nivel = 'revision';
    valor = `Vigente hasta el ${fechaCorta(a.actual.hasta)} (vence en ${a.diasParaVencer} días)`;
    hallazgos.push(hallazgo(ctx, id, 'revision', {
      titulo: `El SOAT vence en ${a.diasParaVencer} días`,
      queEncontramos: `El SOAT vigente vence el ${fechaCorta(a.actual.hasta)}.`,
      queSignifica: 'Tendrás que renovarlo casi de inmediato después de la compra.',
      queHacer: RENOVAR_PRONTO
    }));
  } else {
    nivel = 'sin_hallazgos';
    valor = `Vigente hasta el ${fechaCorta(a.actual.hasta)}`;
  }

  if (a.huecos.length > 0) {
    nivel = peorNivel(nivel, 'revision');
    const total = a.huecos.reduce((s, h) => s + h.dias, 0);
    hallazgos.push(hallazgo(ctx, id, 'revision', {
      titulo: `${duracion(total)} sin SOAT`,
      queEncontramos: `No hay SOAT registrado ${listaHuecos(a.huecos)}.`,
      queSignifica: 'El vehículo estuvo guardado, o circuló sin seguro. Si circuló, pudo recibir comparendos.',
      queHacer: PREGUNTAR_HUECO
    }));
  }

  return { verificacion: verificacion(ctx, id, nombre, nivel, valor), hallazgos };
}

/**
 * Plazo para la primera revisión técnico-mecánica, con los años cumplidos desde la matrícula:
 * particulares 5 años; motos y servicio público 2 años.
 * Art. 52 de la Ley 769 de 2002, modificado por el art. 179 de la Ley 2294 de 2023
 * (antes 6 años, por el Decreto Ley 19 de 2012). Circular MinTransporte 20234000000637.
 */
function inicioObligacionRtm(v: VehiculoRunt): string | null {
  if (!v.fechaMatricula) return null;
  const clase = `${v.clasificacion ?? ''} ${v.clase ?? ''}`.toUpperCase();
  const esMoto = /MOTO|CUATRIMOTO|MOTOCARRO|CICLOMOTOR|TRICIMOTO/.test(clase);
  const esPublico = /P[UÚ]BLICO/i.test(v.servicio ?? '');
  return sumarAnios(v.fechaMatricula, esMoto || esPublico ? 2 : 5);
}

export function reglaRtm(v: VehiculoRunt, ctx: Contexto): Resultado {
  const id = 'rtm';
  const nombre = 'Revisión técnico-mecánica';
  const obligacion = inicioObligacionRtm(v);
  const a = analizarVigencias(v.rtm, ctx.hoy, obligacion ?? undefined);
  const hallazgos: Hallazgo[] = [];
  let nivel: Nivel;
  let valor: string;

  if (!a.actual && v.rtmExento) {
    nivel = 'sin_hallazgos';
    valor = 'Aún no es obligatoria';
  } else if (!a.actual && v.rtmEnDisputa) {
    nivel = 'revision';
    valor = 'Sin revisión: la obligación está en discusión';
    hallazgos.push(hallazgo(ctx, id, 'revision', {
      titulo: 'No es claro si ya le toca la revisión técnico-mecánica',
      queEncontramos: 'El vehículo no tiene revisión vigente. Fue matriculado antes del 19 de mayo de 2023 y tiene entre 5 y 6 años de matrícula.',
      queSignifica: 'La Ley 2294 de 2023 bajó el plazo de la primera revisión de 6 a 5 años, y hay interpretaciones distintas sobre si aplica a los vehículos matriculados antes. Un agente de tránsito podría multarlo.',
      queHacer: 'Acuerda con el vendedor que haga la revisión antes del traspaso: además te dice en qué estado mecánico está.'
    }));
  } else if (!a.actual && obligacion && ctx.hoy < obligacion) {
    nivel = 'sin_hallazgos';
    valor = `Aún no es obligatoria (primera revisión antes del ${fechaCorta(obligacion)})`;
  } else if (a.registros.length === 0) {
    nivel = 'alerta';
    valor = 'Sin revisión registrada';
    hallazgos.push(hallazgo(ctx, id, 'alerta', {
      titulo: 'No hay revisión técnico-mecánica registrada',
      queEncontramos: 'El RUNT no tiene certificados de revisión técnico-mecánica para este vehículo.',
      queSignifica: 'Por su antigüedad, el vehículo ya debería tener la revisión. Sin ella no puede circular legalmente.',
      queHacer: 'Pide al vendedor el certificado vigente, o acuerda que haga la revisión antes del traspaso.'
    }));
  } else if (!a.actual) {
    nivel = 'alerta';
    valor = `Vencida desde el ${fechaCorta(a.ultimoVencimiento)}`;
    hallazgos.push(hallazgo(ctx, id, 'alerta', {
      titulo: 'La revisión técnico-mecánica está vencida',
      queEncontramos: `La última revisión registrada venció el ${fechaCorta(a.ultimoVencimiento)}.`,
      queSignifica: 'El vehículo no puede circular legalmente hasta aprobar una nueva revisión.',
      queHacer: 'Pide que el vendedor haga la revisión antes del traspaso: si no la aprueba, sabrás qué fallas tiene.'
    }));
  } else if (a.diasParaVencer! <= UMBRAL_POR_VENCER_DIAS) {
    nivel = 'revision';
    valor = `Vigente hasta el ${fechaCorta(a.actual.hasta)} (vence en ${a.diasParaVencer} días)`;
    hallazgos.push(hallazgo(ctx, id, 'revision', {
      titulo: `La revisión técnico-mecánica vence en ${a.diasParaVencer} días`,
      queEncontramos: `La revisión vigente vence el ${fechaCorta(a.actual.hasta)}.`,
      queSignifica: 'Tendrás que llevar el vehículo a revisión casi de inmediato después de la compra.',
      queHacer: RENOVAR_PRONTO
    }));
  } else {
    nivel = 'sin_hallazgos';
    valor = `Vigente hasta el ${fechaCorta(a.actual.hasta)}`;
  }

  if (a.huecos.length > 0) {
    nivel = peorNivel(nivel, 'revision');
    const total = a.huecos.reduce((s, h) => s + h.dias, 0);
    hallazgos.push(hallazgo(ctx, id, 'revision', {
      titulo: `${duracion(total)} sin revisión técnico-mecánica`,
      queEncontramos: `La revisión estuvo vencida ${listaHuecos(a.huecos)}.`,
      queSignifica: 'El vehículo estuvo guardado, o circuló sin revisión vigente. Si circuló, pudo recibir comparendos.',
      queHacer: PREGUNTAR_HUECO
    }));
  }

  return { verificacion: verificacion(ctx, id, nombre, nivel, valor), hallazgos };
}

export function reglaGravamenes(v: VehiculoRunt, ctx: Contexto): Resultado {
  const id = 'gravamenes';
  const nombre = 'Embargos y limitaciones';
  const n = v.limitaciones.length;

  if (v.tieneGravamenes === true || n > 0) {
    const detalle = n > 0
      ? v.limitaciones.map((l) => [l.tipo ?? 'Limitación', l.entidad && `ordenada por ${l.entidad}`, l.fecha && `el ${fechaCorta(l.fecha)}`].filter(Boolean).join(' ')).join('; ')
      : 'El RUNT marca que el vehículo tiene gravámenes';
    return {
      verificacion: verificacion(ctx, id, nombre, 'alerta', n > 0 ? `${n} ${n === 1 ? 'limitación' : 'limitaciones'}` : 'Tiene gravámenes'),
      hallazgos: [hallazgo(ctx, id, 'alerta', {
        titulo: 'El vehículo tiene limitaciones a la propiedad',
        queEncontramos: `${detalle}.`,
        queSignifica: 'Mientras exista un embargo o una limitación, el traspaso no se puede inscribir a tu nombre.',
        queHacer: 'Exige el levantamiento de la medida, con el oficio que lo ordena, antes de pagar.'
      })]
    };
  }
  if (v.tieneGravamenes === null) return { verificacion: verificacion(ctx, id, nombre, 'no_disponible', null), hallazgos: [] };
  return { verificacion: verificacion(ctx, id, nombre, 'sin_hallazgos', 'Sin embargos ni limitaciones'), hallazgos: [] };
}

export function reglaPrendas(v: VehiculoRunt, ctx: Contexto): Resultado {
  const id = 'prendas';
  const nombre = 'Prendas';
  if (v.tienePrendas === true || v.garantiasMobiliarias > 0) {
    return {
      verificacion: verificacion(ctx, id, nombre, 'alerta', 'Tiene prenda'),
      hallazgos: [hallazgo(ctx, id, 'alerta', {
        titulo: 'El vehículo tiene una prenda',
        queEncontramos: 'El RUNT registra una prenda o garantía mobiliaria sobre el vehículo.',
        queSignifica: 'El vehículo respalda una deuda. Para el traspaso, el acreedor debe levantar la prenda.',
        queHacer: 'Pide el paz y salvo del acreedor y verifica que el levantamiento quede inscrito en el RUNT antes de pagar.'
      })]
    };
  }
  if (v.tienePrendas === null) return { verificacion: verificacion(ctx, id, nombre, 'no_disponible', null), hallazgos: [] };
  return { verificacion: verificacion(ctx, id, nombre, 'sin_hallazgos', 'Sin prendas'), hallazgos: [] };
}

export function reglaRegrabados(v: VehiculoRunt, ctx: Contexto): Resultado {
  const id = 'regrabados';
  const nombre = 'Regrabado de motor, chasis o VIN';
  const r = v.regrabados;
  const partes = [r.motor && 'motor', r.chasis && 'chasis', r.serie && 'serie', r.vin && 'VIN'].filter(Boolean) as string[];

  if (partes.length > 0) {
    return {
      verificacion: verificacion(ctx, id, nombre, 'revision', `Regrabado: ${partes.join(', ')}`),
      hallazgos: [hallazgo(ctx, id, 'revision', {
        titulo: `Número de ${partes.join(', ')} regrabado`,
        queEncontramos: `El RUNT registra regrabado de: ${partes.join(', ')}.`,
        queSignifica: 'Un regrabado puede ser legal si fue autorizado (por ejemplo, por corrosión), pero también es una señal frecuente en vehículos alterados.',
        queHacer: 'Pide el soporte de la autorización y verifica que los números del vehículo coincidan con la licencia de tránsito, con una revisión de improntas.'
      })]
    };
  }
  if (Object.values(r).every((x) => x === null)) return { verificacion: verificacion(ctx, id, nombre, 'no_disponible', null), hallazgos: [] };
  return { verificacion: verificacion(ctx, id, nombre, 'sin_hallazgos', 'Sin regrabados'), hallazgos: [] };
}

export function reglaDesintegracion(v: VehiculoRunt, ctx: Contexto): Resultado {
  const id = 'desintegracion';
  const nombre = 'Desintegración';
  if (v.desintegrado === null) return { verificacion: verificacion(ctx, id, nombre, 'no_disponible', null), hallazgos: [] };
  if (!v.desintegrado) return { verificacion: verificacion(ctx, id, nombre, 'sin_hallazgos', 'Sin registro'), hallazgos: [] };
  return {
    verificacion: verificacion(ctx, id, nombre, 'alerta', 'Registra desintegración'),
    hallazgos: [hallazgo(ctx, id, 'alerta', {
      titulo: 'El vehículo registra desintegración',
      queEncontramos: 'El RUNT tiene un registro de desintegración (chatarrización) para este vehículo.',
      queSignifica: 'Un vehículo con certificado de desintegración no puede volver a circular ni traspasarse.',
      queHacer: 'No hagas ningún pago y consulta el caso con el organismo de tránsito.'
    })]
  };
}

/** Solo se informa cuando el RUNT muestra la validación (verValidaDIAN). Si no la muestra, no es concluyente. */
export function reglaDian(v: VehiculoRunt, ctx: Contexto): Resultado | null {
  if (!v.dian.visible) return null;
  const id = 'validacion_dian';
  const nombre = 'Validación DIAN';
  if (v.dian.validacion?.toUpperCase() === 'EXITOSO') {
    return { verificacion: verificacion(ctx, id, nombre, 'sin_hallazgos', 'Exitosa'), hallazgos: [] };
  }
  return {
    verificacion: verificacion(ctx, id, nombre, 'revision', v.dian.validacion ?? 'Sin resultado'),
    hallazgos: [hallazgo(ctx, id, 'revision', {
      titulo: 'La validación DIAN no fue exitosa',
      queEncontramos: `El RUNT muestra la validación DIAN como "${v.dian.validacion ?? 'sin resultado'}".`,
      queSignifica: 'Puede haber una inconsistencia en los documentos de importación del vehículo.',
      queHacer: 'Pide al vendedor la declaración de importación y confírmala con el organismo de tránsito antes del traspaso.'
    })]
  };
}
