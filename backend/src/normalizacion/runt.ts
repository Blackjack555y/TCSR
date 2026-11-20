import type { Limitacion, VehiculoRunt, Vigencia } from '../dominio/tipos.js';
import type { RawConsultaRunt } from '../placapi/tipos.js';
import { entero, fecha, siNo, texto } from './valores.js';

/**
 * Traduce la respuesta de /consulta al modelo propio.
 * Aquí se descarta el documento del propietario (data.documentNumber) y el detalle de
 * garantías mobiliarias, que trae nombres y documentos de terceros: solo se conserva el conteo.
 */
export function normalizarRunt(raw: RawConsultaRunt): VehiculoRunt {
  const d = raw.data ?? {};
  const g = d.informacionGeneral ?? {};

  const soat: Vigencia[] = (d.soat ?? []).map((s) => ({
    desde: fecha(s.fechaVigencia),
    hasta: fecha(s.fechaVencimiento),
    entidad: texto(s.entidadExpideSoat),
    estadoFuente: texto(s.estado)
  }));

  const rtm: Vigencia[] = (d.tecnoMecanica ?? []).map((r) => ({
    desde: fecha(r.fechaExpedicion),
    hasta: fecha(r.fechaVencimiento),
    entidad: texto(r.cdaExpide),
    estadoFuente: texto(r.estado)
  }));

  const limitaciones: Limitacion[] = (d.limitacionPropiedad ?? []).map((l) => ({
    tipo: texto(l.tipoLimitacion ?? l.tipo),
    fecha: fecha(l.fechaExpedicion ?? l.fecha),
    entidad: texto(l.entidadJuridica ?? l.entidad)
  }));

  const garantias = (d.garantiasMobiliarias?.length ?? 0) || (d.prendasGarantiaMobiliaria?.length ?? 0);

  return {
    placa: (texto(g.noPlaca) ?? texto(d.plate) ?? '').toUpperCase(),
    marca: texto(g.marca),
    linea: texto(g.linea),
    modelo: entero(g.modelo),
    clase: texto(g.claseVehiculo),
    clasificacion: texto(g.clasificacion),
    servicio: texto(g.tipoServicio),
    color: texto(g.color),
    cilindraje: texto(g.cilindraje),
    combustible: texto(g.tipoCombustible),
    carroceria: texto(g.tipoCarroceria),
    organismoTransito: texto(g.organismoTransito),
    fechaMatricula: fecha(g.fechaMatricula) ?? fecha(g.fechaRegistro),
    estado: texto(g.estadoDelVehiculo),
    vin: texto(g.noVin) ?? texto(d.vin),
    numeroMotor: texto(g.noMotor),
    numeroChasis: texto(g.noChasis),
    regrabados: {
      chasis: siNo(g.esRegrabadoChasis),
      motor: siNo(g.esRegrabadoMotor),
      serie: siNo(g.esRegrabadoSerie),
      vin: siNo(g.esRegrabadoVin)
    },
    tieneGravamenes: siNo(g.tieneGravamenes),
    tienePrendas: siNo(g.prendas),
    limitaciones,
    garantiasMobiliarias: garantias,
    blindado: siNo(d.informacionBlindaje?.blindado),
    repotenciado: siNo(g.repotenciado),
    desintegrado: d.desintegracion != null || d.certificadoDesintegracion != null,
    dian: {
      validacion: texto(g.validacionDIAN),
      // Si el RUNT no muestra la validación, el resultado no es concluyente.
      visible: siNo(g.verValidaDIAN) === true
    },
    soat,
    rtm
  };
}
