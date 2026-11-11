import type { Avaluo, Hallazgo, Historial, Hurto, IdVerificacion, Impuestos, Multas, Nivel, Prenda, Siniestros, Verificacion } from '../dominio/tipos.js';
import { fechaCorta, sumarAnios } from './fechas.js';
import type { Resultado } from './runt.js';

/** Tres o más traspasos en este periodo se reportan. */
const ANIOS_VENTANA_TRASPASOS = 2;
const UMBRAL_TRASPASOS = 3;

const pesos = (n: number) => `$ ${new Intl.NumberFormat('es-CO').format(n)}`;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

interface Base {
  id: IdVerificacion;
  nombre: string;
  fuente: string;
  consultadoEn: string | null;
}

const verif = (b: Base, nivel: Nivel, valor: string | null): Verificacion => ({
  id: b.id, nombre: b.nombre, fuente: b.fuente, consultadoEn: b.consultadoEn, nivel, valor, consulta: 'ok'
});

const hallazgo = (b: Base, nivel: 'revision' | 'alerta', t: Pick<Hallazgo, 'titulo' | 'queEncontramos' | 'queSignifica' | 'queHacer'>): Hallazgo => ({
  verificacion: b.id, fuente: b.fuente, consultadoEn: b.consultadoEn, nivel, ...t
});

export function reglaHurto(d: Hurto, b: Base): Resultado {
  if (d.denunciaActiva || d.extincionDominio > 0) {
    const dominio = d.extincionDominio > 0;
    return {
      verificacion: verif(b, 'alerta', dominio ? 'Proceso de extinción de dominio' : 'Denuncia de hurto activa'),
      hallazgos: [hallazgo(b, 'alerta', {
        titulo: dominio ? 'El vehículo está vinculado a una extinción de dominio' : 'Hay una denuncia de hurto activa',
        queEncontramos: dominio
          ? 'La placa aparece en un proceso de extinción de dominio.'
          : 'La placa tiene una denuncia de hurto en estado activo.',
        queSignifica: 'Podrías perder el vehículo aunque lo hayas pagado. Una denuncia activa no siempre significa que siga desaparecido, y una placa mal digitada en una denuncia puede caer sobre otra placa.',
        queHacer: 'No hagas ningún pago hasta aclararlo con la SIJIN o la Fiscalía, y compara los datos del vehículo con los de la denuncia.'
      })]
    };
  }
  if (d.totalRegistros > 0) {
    return {
      verificacion: verif(b, 'revision', plural(d.totalRegistros, 'registro', 'registros')),
      hallazgos: [hallazgo(b, 'revision', {
        titulo: 'La placa aparece en registros judiciales',
        queEncontramos: `La placa aparece en ${plural(d.totalRegistros, 'proceso penal', 'procesos penales')}, sin denuncia de hurto activa.`,
        queSignifica: 'Puede ser un caso cerrado, por ejemplo un accidente, pero conviene saber de qué se trató.',
        queHacer: 'Pregúntale al vendedor por esos registros y revisa el detalle en la sección de evidencia.'
      })]
    };
  }
  return { verificacion: verif(b, 'sin_hallazgos', 'Sin registros'), hallazgos: [] };
}

export function reglaSiniestros(d: Siniestros, b: Base): Resultado {
  if (d.perdidaTotal) {
    return {
      verificacion: verif(b, 'alerta', 'Registra pérdida total'),
      hallazgos: [hallazgo(b, 'alerta', {
        titulo: 'El vehículo registra pérdida total',
        queEncontramos: 'Una aseguradora indemnizó el vehículo completo por pérdida total.',
        queSignifica: 'Sufrió un daño o evento grave. Si volvió a circular, pudo ser reconstruido y su valor y seguridad se ven afectados.',
        queHacer: 'Haz un peritaje completo de estructura antes de seguir, y ten en cuenta que puede ser difícil asegurarlo.'
      })]
    };
  }
  if (d.total > 0) {
    return {
      verificacion: verif(b, 'revision', plural(d.total, 'reclamación', 'reclamaciones')),
      hallazgos: [hallazgo(b, 'revision', {
        titulo: `${plural(d.total, 'reclamación', 'reclamaciones')} a aseguradoras`,
        queEncontramos: `El vehículo tiene ${plural(d.total, 'reclamación menor registrada', 'reclamaciones menores registradas')}.`,
        queSignifica: 'Tuvo daños reparados con cargo a un seguro. La fuente no informa el valor ni qué se reparó.',
        queHacer: 'Pregúntale al vendedor qué pasó y pide a un perito que revise las reparaciones.'
      })]
    };
  }
  return { verificacion: verif(b, 'sin_hallazgos', 'Sin reclamaciones (solo cubre vehículos asegurados)'), hallazgos: [] };
}

export function reglaPrendasDetalle(prendas: Prenda[], b: Base): Resultado {
  if (prendas.length === 0) return { verificacion: verif(b, 'sin_hallazgos', 'Sin prendas'), hallazgos: [] };
  const lista = prendas.map((p) => `${p.acreedor}${p.fecha ? ` (inscrita el ${fechaCorta(p.fecha)})` : ''}`).join('; ');
  return {
    verificacion: verif(b, 'alerta', plural(prendas.length, 'prenda', 'prendas')),
    hallazgos: [hallazgo(b, 'alerta', {
      titulo: 'El vehículo tiene una prenda',
      queEncontramos: `Prenda a favor de: ${lista}.`,
      queSignifica: 'El vehículo respalda una deuda. Para el traspaso, el acreedor debe levantar la prenda.',
      queHacer: 'Pide el paz y salvo del acreedor y verifica que el levantamiento quede inscrito antes de pagar.'
    })]
  };
}

export function reglaMultas(d: Multas, b: Base): Resultado {
  if (d.totalDeuda > 0) {
    return {
      verificacion: verif(b, 'alerta', `Deuda de ${pesos(d.totalDeuda)}`),
      hallazgos: [hallazgo(b, 'alerta', {
        titulo: 'Hay multas pendientes en el SIMIT',
        queEncontramos: `La deuda registrada es de ${pesos(d.totalDeuda)} en ${plural(d.totalMultas, 'multa', 'multas')}.`,
        queSignifica: 'El traspaso exige estar a paz y salvo: las multas pendientes pueden frenarlo.',
        queHacer: 'Exige el paz y salvo del SIMIT antes de pagar, o descuenta la deuda del precio.'
      })]
    };
  }
  if (d.acuerdosPago > 0) {
    return {
      verificacion: verif(b, 'revision', plural(d.acuerdosPago, 'acuerdo de pago', 'acuerdos de pago')),
      hallazgos: [hallazgo(b, 'revision', {
        titulo: 'Hay un acuerdo de pago en el SIMIT',
        queEncontramos: `Se registra ${plural(d.acuerdosPago, 'acuerdo de pago', 'acuerdos de pago')}.`,
        queSignifica: 'Hay una deuda en cuotas: mientras no esté saldada, puede afectar el traspaso.',
        queHacer: 'Pide al vendedor el estado del acuerdo y confirma el paz y salvo antes de pagar.'
      })]
    };
  }
  return { verificacion: verif(b, 'sin_hallazgos', 'Sin deuda'), hallazgos: [] };
}

export function reglaImpuestos(d: Impuestos, b: Base): Resultado {
  if (d.totalPendiente > 0 || d.deudaSinMonto) {
    const valor = d.deudaSinMonto ? 'Deuda sin monto publicado' : `Pendiente: ${pesos(d.totalPendiente)}`;
    const anios = d.aniosPendientes.length > 0 ? ` de ${d.aniosPendientes.join(', ')}` : '';
    return {
      verificacion: verif(b, 'revision', valor),
      hallazgos: [hallazgo(b, 'revision', {
        titulo: 'Hay impuesto vehicular pendiente',
        queEncontramos: d.deudaSinMonto
          ? `${d.departamento ?? 'La gobernación'} registra facturas sin pagar, pero no publica el monto.`
          : `${d.departamento ?? 'El departamento'} registra ${pesos(d.totalPendiente)} pendientes${anios}.`,
        queSignifica: 'Si no se paga antes del traspaso, la deuda puede quedar a tu cargo.',
        queHacer: 'Pide el comprobante de pago del impuesto o descuéntalo del precio.'
      })]
    };
  }
  return { verificacion: verif(b, 'sin_hallazgos', 'Sin deuda pendiente'), hallazgos: [] };
}

export function reglaHistorial(d: Historial, b: Base, hoy: string): Resultado {
  const recientes = d.traspasos.filter((f) => sumarAnios(f, ANIOS_VENTANA_TRASPASOS) >= hoy).length;
  const valor = [d.propietarios != null && plural(d.propietarios, 'propietario', 'propietarios'), plural(d.traspasos.length, 'traspaso', 'traspasos')]
    .filter(Boolean).join(' · ');

  if (recientes >= UMBRAL_TRASPASOS) {
    return {
      verificacion: verif(b, 'revision', valor),
      hallazgos: [hallazgo(b, 'revision', {
        titulo: 'Ha cambiado de dueño muchas veces',
        queEncontramos: `Registra ${recientes} traspasos en los últimos ${ANIOS_VENTANA_TRASPASOS} años.`,
        queSignifica: 'Muchos cambios seguidos pueden indicar un vehículo que nadie conserva, o que se revende con frecuencia.',
        queHacer: 'Pregúntale al vendedor por qué ha cambiado tanto de dueño y refuerza la revisión mecánica.'
      })]
    };
  }
  return { verificacion: verif(b, 'sin_hallazgos', valor), hallazgos: [] };
}

export function reglaAvaluo(d: Avaluo, b: Base): Resultado {
  return { verificacion: verif(b, 'sin_hallazgos', `${pesos(d.valorComercial)}${d.aproximado ? ' (aproximado)' : ''}`), hallazgos: [] };
}
