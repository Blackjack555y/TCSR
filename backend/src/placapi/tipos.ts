// Forma cruda de las respuestas de PlacApi. Solo se tipan los campos que usamos;
// todo es opcional y nullable porque la fuente omite o deja en null lo que no tiene.

type Txt = string | null | undefined;

export interface RawSoat {
  entidadExpideSoat?: Txt;
  estado?: Txt;
  fechaVigencia?: Txt;
  fechaVencimiento?: Txt;
}

export interface RawRtm {
  cdaExpide?: Txt;
  estado?: Txt;
  fechaExpedicion?: Txt;
  fechaVencimiento?: Txt;
  vigente?: Txt;
}

export interface RawLimitacion {
  tipoLimitacion?: Txt;
  tipo?: Txt;
  fechaExpedicion?: Txt;
  fecha?: Txt;
  entidadJuridica?: Txt;
  entidad?: Txt;
}

export interface RawConsultaRunt {
  data?: {
    /** Documento del propietario enviado en la petición. Nunca sale de la capa de normalización. */
    documentNumber?: Txt;
    plate?: Txt;
    vin?: Txt;
    informacionGeneral?: Record<string, string | boolean | null | undefined>;
    informacionBlindaje?: { blindado?: Txt } | null;
    limitacionPropiedad?: RawLimitacion[] | null;
    garantiasMobiliarias?: unknown[] | null;
    prendasGarantiaMobiliaria?: unknown[] | null;
    soat?: RawSoat[] | null;
    tecnoMecanica?: RawRtm[] | null;
    desintegracion?: unknown;
    certificadoDesintegracion?: unknown;
  };
  mode?: string;
  fetchedAt?: string;
}

interface RawBloque<T> {
  /** Créditos cobrados por la llamada, cuando PlacApi lo informa. */
  cost?: number;
  /** La respuesta salió del caché de PlacApi: no se cobra. */
  fromCache?: boolean;
  source?: string;
  /** ok, warn, danger, info, empty o error, según la fuente. */
  status?: string;
  fetchedAt?: string;
  data?: T | null;
}

export interface RawHurto {
  reportadoHurto?: boolean;
  denunciaHurtoActiva?: boolean;
  totalRegistros?: number;
  registros?: { categoria?: Txt; fechaVinculacion?: Txt; estadoCaso?: Txt }[] | null;
  extincionDominio?: unknown[] | null;
}

export interface RawSiniestros {
  perdidaTotal?: boolean;
  totalSiniestros?: number;
  siniestros?: { fecha?: Txt; amparo?: Txt; severidad?: Txt }[] | null;
}

export interface RawGarantias {
  tienePrenda?: boolean;
  /** Trae deudor y documento del deudor: nunca salen de la normalización. */
  garantias?: { acreedores?: string[] | null; fechaInscripcion?: Txt }[] | null;
}

export interface RawAvaluo {
  /** El valor sale de una versión parecida, no del código exacto del vehículo. */
  aproximado?: boolean;
  valorComercial?: number | null;
  rangoMercado?: { min?: number; max?: number } | null;
}

export interface RawFull {
  generatedAt?: string;
  vehicle?: RawBloque<Record<string, unknown>>;
  soat?: RawBloque<{ historico?: { aseguradora?: Txt; fechaInicioVigencia?: Txt; fechaExpedicion?: Txt; fechaVencimiento?: Txt; estado?: Txt }[] | null }>;
  rtm?: RawBloque<{ exento?: boolean; historico?: { cda?: Txt; fechaExpedicion?: Txt; fechaVencimiento?: Txt; estado?: Txt }[] | null }>;
  antecedentes?: RawBloque<{
    prendas?: { acreedor?: Txt; tipoDocAcreedor?: Txt; fechaInscripcion?: Txt }[] | null;
    embargos?: Record<string, unknown>[] | null;
    historicoPropietarios?: number | null;
  }>;
  simit?: RawBloque<{ totalDeuda?: number; totalMultas?: number; acuerdosPago?: number }>;
  impuestos?: RawBloque<{ departamento?: Txt; anios?: { anio?: number; pagado?: boolean }[] | null; totalPendiente?: number | null; deudaSinMonto?: unknown }>;
  fasecolda?: RawBloque<RawAvaluo>;
}

export type RespuestaBloque<T> = RawBloque<T>;

export type TipoDocumento = 'CC' | 'CE' | 'NIT' | 'PA' | 'PPT';

export interface ParametrosFull {
  placa: string;
  docType: TipoDocumento;
  docNumber: string;
}

/** Puerto hacia el proveedor de datos. La implementación real y la simulada lo cumplen. */
export interface FuenteVehicular {
  consultaFull(p: ParametrosFull): Promise<RawFull>;
  consultaPorVin(vin: string): Promise<RawConsultaRunt>;
  avaluoPorVin(vin: string): Promise<RawBloque<RawAvaluo>>;
  reporteHurto(placa: string): Promise<RawBloque<RawHurto>>;
  perdidaTotal(placa: string): Promise<RawBloque<RawSiniestros>>;
  garantiasRgm(placa: string): Promise<RawBloque<RawGarantias>>;
}
