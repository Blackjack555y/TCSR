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

export type TipoDocumento = 'CC' | 'CE' | 'NIT' | 'PA' | 'PPT';

export interface ParametrosConsulta {
  placa: string;
  docType: TipoDocumento;
  docNumber: string;
}

/** Puerto hacia el proveedor de datos. La implementación real y la simulada lo cumplen. */
export interface FuenteVehicular {
  consultarRunt(p: ParametrosConsulta): Promise<RawConsultaRunt>;
}
