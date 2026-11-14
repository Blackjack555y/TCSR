import type { Accidentes, Avaluo, Bloque, DatosConsulta, Historial, Hurto, Impuestos, Limitacion, Multas, Prenda, Siniestros, VehiculoRunt, Vigencia } from '../dominio/tipos.js';
import type { RawAccidentes, RawAvaluo, RawFull, RawGarantias, RawHurto, RawSiniestros, RespuestaBloque } from '../placapi/tipos.js';
import { entero, fecha, siNo, texto } from './valores.js';

// Traduce los bloques de PlacApi al modelo propio. Aquí se quedan los datos de terceros:
// deudores, documentos, noticias criminales y detalle de multas no pasan de esta capa.

const ACREEDOR_EMPRESA = /\b(S\.?\s?A\.?\s?S?\.?|LTDA|BANCO|BANCOLOMBIA|DAVIVIENDA|FINANCI|COMPA[ÑN][IÍ]A|CORPORACI|COOPERATIVA|FONDO|LEASING|FIDUCI|CR[EÉ]DITO)\b/i;

/** El acreedor puede ser una persona natural: en ese caso no se muestra su nombre. */
export function acreedorSeguro(nombre: unknown, tipoDoc?: unknown): string {
  const n = texto(nombre);
  if (n && (texto(tipoDoc) === 'NIT' || ACREEDOR_EMPRESA.test(n))) return n;
  return 'Persona natural (dato protegido)';
}

/** Convierte un bloque crudo: si falló o vino vacío, nunca se interpreta como "sin hallazgos". */
export function bloque<R, T>(b: RespuestaBloque<R> | undefined, mapear: (datos: R) => T): Bloque<T> {
  const consultadoEn = b?.fetchedAt ?? null;
  if (!b || b.status === 'error') return { estado: 'error', consultadoEn };
  if (b.data == null) return { estado: 'no_cubierta', consultadoEn };
  return { estado: 'ok', datos: mapear(b.data), consultadoEn };
}

export function normalizarHurto(d: RawHurto): Hurto {
  return {
    denunciaActiva: d.denunciaHurtoActiva === true,
    reportado: d.reportadoHurto === true,
    totalRegistros: d.totalRegistros ?? d.registros?.length ?? 0,
    extincionDominio: d.extincionDominio?.length ?? 0,
    registros: (d.registros ?? []).map((r) => ({
      categoria: texto(r.categoria),
      fecha: fecha(r.fechaVinculacion),
      estado: texto(r.estadoCaso)
    }))
  };
}

export function normalizarSiniestros(d: RawSiniestros): Siniestros {
  return {
    perdidaTotal: d.perdidaTotal === true,
    total: d.totalSiniestros ?? d.siniestros?.length ?? 0,
    registros: (d.siniestros ?? []).map((s) => ({ fecha: fecha(s.fecha), amparo: texto(s.amparo), severidad: texto(s.severidad) }))
  };
}

export function normalizarAccidentes(d: RawAccidentes): Accidentes {
  const registros = (d.accidentes ?? []).map((a) => ({ fecha: fecha(a.fecha), gravedad: texto(a.gravedad) }));
  return { total: d.totalAccidentes ?? registros.length, gravedadMaxima: texto(d.gravedadMaxima)?.toLowerCase() ?? null, registros };
}

export function normalizarGarantias(d: RawGarantias): Prenda[] {
  if (!d.tienePrenda) return [];
  return (d.garantias ?? []).map((g) => ({
    acreedor: (g.acreedores ?? []).map((a) => acreedorSeguro(a)).join(', ') || 'No informado',
    fecha: fecha(g.fechaInscripcion)
  }));
}

export function normalizarAvaluo(d: RawAvaluo): Avaluo {
  const min = d.rangoMercado?.min;
  const max = d.rangoMercado?.max;
  return { aproximado: d.aproximado === true, valorComercial: d.valorComercial ?? 0, rango: min != null && max != null ? { min, max } : null };
}

const textoNum = (v: unknown) => (typeof v === 'number' ? String(v) : texto(v));

function vigenciasSoat(raw: RawFull): Vigencia[] {
  return (raw.soat?.data?.historico ?? []).map((s) => ({
    desde: fecha(s.fechaInicioVigencia ?? s.fechaExpedicion),
    hasta: fecha(s.fechaVencimiento),
    entidad: texto(s.aseguradora),
    estadoFuente: texto(s.estado)
  }));
}

function vigenciasRtm(raw: RawFull): Vigencia[] {
  return (raw.rtm?.data?.historico ?? []).map((r) => ({
    desde: fecha(r.fechaExpedicion),
    hasta: fecha(r.fechaVencimiento),
    entidad: texto(r.cda),
    estadoFuente: texto(r.estado)
  }));
}

function vehiculoFull(raw: RawFull, v: Record<string, unknown>): VehiculoRunt {
  const a = raw.antecedentes?.status === 'error' ? null : raw.antecedentes?.data ?? null;
  const embargos = a?.embargos ?? [];
  const limitaciones: Limitacion[] = embargos.map((e) => ({
    tipo: texto(e.tipo ?? e.tipoLimitacion),
    fecha: fecha(e.fecha ?? e.fechaExpedicion),
    entidad: texto(e.entidad ?? e.entidadJuridica)
  }));
  const reg = Array.isArray(v.regrabados) ? v.regrabados.map((r) => String(r).toUpperCase()) : null;
  const regrabado = (p: string) => (reg ? reg.some((r) => r.includes(p)) : null);
  const estado = texto(v.estado);

  return {
    placa: (texto(v.placa) ?? '').toUpperCase(),
    marca: texto(v.marca),
    linea: texto(v.linea),
    modelo: entero(v.modelo),
    clase: texto(v.clase),
    clasificacion: texto(v.clasificacion),
    servicio: texto(v.servicio),
    color: texto(v.color),
    cilindraje: textoNum(v.cilindraje),
    combustible: texto(v.combustible),
    carroceria: texto(v.carroceria),
    organismoTransito: texto(v.organismoTransito),
    fechaMatricula: fecha(v.fechaMatricula),
    estado: estado?.toUpperCase() ?? null,
    vin: texto(v.vin),
    numeroMotor: texto(v.motor),
    numeroChasis: texto(v.chasis),
    regrabados: { chasis: regrabado('CHASIS'), motor: regrabado('MOTOR'), serie: regrabado('SERIE'), vin: regrabado('VIN') },
    tieneGravamenes: a ? embargos.length > 0 : null,
    tienePrendas: a ? (a.prendas?.length ?? 0) > 0 : null,
    limitaciones,
    garantiasMobiliarias: a?.prendas?.length ?? 0,
    blindado: null,
    repotenciado: siNo(v.repotenciado),
    desintegrado: estado ? /DESINTEGR|CHATARR/i.test(estado) : null,
    // /consulta-full no trae la validación DIAN.
    dian: { validacion: null, visible: false },
    soat: vigenciasSoat(raw),
    rtm: vigenciasRtm(raw),
    rtmExento: raw.rtm?.data?.exento === true,
    rtmEnDisputa: raw.rtm?.data?.enDisputa === true
  };
}

function multas(raw: RawFull): Bloque<Multas> {
  return bloque(raw.simit, (d) => ({
    totalDeuda: d.totalDeuda ?? 0,
    totalMultas: d.totalMultas ?? 0,
    acuerdosPago: d.acuerdosPago ?? 0
  }));
}

function impuestos(raw: RawFull): Bloque<Impuestos> {
  return bloque(raw.impuestos, (d) => ({
    departamento: texto(d.departamento),
    totalPendiente: d.totalPendiente ?? 0,
    aniosPendientes: (d.anios ?? []).filter((a) => a.pagado === false && a.anio != null).map((a) => a.anio!),
    deudaSinMonto: d.deudaSinMonto != null && d.deudaSinMonto !== false
  }));
}

function historial(raw: RawFull): Bloque<Historial> {
  const v = raw.vehicle;
  if (!v?.data || v.status === 'error') return { estado: 'error', consultadoEn: v?.fetchedAt ?? null };
  const tramites = Array.isArray(v.data.tramites) ? (v.data.tramites as { tramite?: unknown; fecha?: unknown }[]) : [];
  const traspasos = tramites
    .filter((t) => /TRASPASO/i.test(String(t.tramite ?? '')))
    .map((t) => fecha(t.fecha))
    .filter((f): f is string => f !== null);
  return {
    estado: 'ok',
    consultadoEn: v.fetchedAt ?? null,
    datos: { propietarios: raw.antecedentes?.data?.historicoPropietarios ?? null, traspasos }
  };
}

const disponible = (b?: RespuestaBloque<unknown>) => !!b && b.status !== 'error' && b.data != null;

/** Lo que aporta /consulta-full. Hurto, siniestros y accidentes vienen de otras llamadas. */
export function normalizarFull(raw: RawFull): Omit<DatosConsulta, 'tipo' | 'hurto' | 'siniestros' | 'accidentes'> {
  const vb = raw.vehicle;
  const vehiculo: Bloque<VehiculoRunt> = bloque(vb, (d) => vehiculoFull(raw, d));
  const placa = vehiculo.estado === 'ok' ? vehiculo.datos.placa || null : null;

  return {
    placa,
    vehiculo,
    // Un bloque vacío o fallido no significa "no tiene SOAT": se reporta como no disponible.
    soatDisponible: disponible(raw.soat),
    rtmDisponible: disponible(raw.rtm),
    legalDisponible: disponible(raw.antecedentes),
    prendas: bloque(raw.antecedentes, (d) => (d.prendas ?? []).map((p) => ({
      acreedor: acreedorSeguro(p.acreedor, p.tipoDocAcreedor),
      fecha: fecha(p.fechaInscripcion)
    }))),
    multas: multas(raw),
    impuestos: impuestos(raw),
    historial: historial(raw),
    avaluo: bloque(raw.fasecolda, normalizarAvaluo)
  };
}
