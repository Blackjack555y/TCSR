// Modelo propio de Carro Sin Rollos. Nada de aquí depende de la forma en que
// responde PlacApi: la capa de normalización traduce hacia estos tipos.

/** Lo que ve el usuario. Cada nivel tiene su color y su texto; nunca se mezclan. */
export type Nivel = 'sin_hallazgos' | 'revision' | 'no_disponible' | 'alerta';

/** Si la fuente respondió. Separado del nivel: "no_disponible" nunca es "sin hallazgos". */
export type EstadoConsulta =
  | 'ok'              // la fuente respondió
  | 'error'           // la fuente falló o no respondió a tiempo
  | 'no_consultada'   // la fuente no está integrada en esta versión del informe
  | 'no_cubierta';    // la fuente respondió pero no publica ese dato para este vehículo

export type IdVerificacion =
  | 'estado_matricula'
  | 'soat'
  | 'rtm'
  | 'gravamenes'
  | 'prendas'
  | 'regrabados'
  | 'desintegracion'
  | 'validacion_dian'
  | 'multas'
  | 'impuestos'
  | 'hurto'
  | 'siniestros'
  | 'propietarios'
  | 'antecedentes_propietario';

export interface Verificacion {
  id: IdVerificacion;
  nombre: string;
  consulta: EstadoConsulta;
  /** El dato real, listo para mostrar ("Vigente hasta el 03/11/2026"). */
  valor: string | null;
  nivel: Nivel;
  fuente: string;
  /** Fecha ISO en que se obtuvo el dato (puede venir de caché). */
  consultadoEn: string | null;
}

export interface Hallazgo {
  verificacion: IdVerificacion;
  nivel: Exclude<Nivel, 'sin_hallazgos'>;
  titulo: string;
  queEncontramos: string;
  queSignifica: string;
  queHacer: string;
  fuente: string;
  consultadoEn: string | null;
}

// ---------------------------------------------------------------------------
// Vehículo normalizado (fuente: RUNT)
// ---------------------------------------------------------------------------

export interface Vigencia {
  /** Fecha ISO (yyyy-mm-dd) de inicio de la cobertura. */
  desde: string | null;
  /** Fecha ISO (yyyy-mm-dd) de fin de la cobertura. */
  hasta: string | null;
  entidad: string | null;
  estadoFuente: string | null;
}

export interface Limitacion {
  tipo: string | null;
  fecha: string | null;
  entidad: string | null;
}

export interface VehiculoRunt {
  placa: string;
  marca: string | null;
  linea: string | null;
  modelo: number | null;
  clase: string | null;
  /** Clasificación amplia del RUNT: "MOTO", "AUTOMOVIL"... */
  clasificacion: string | null;
  servicio: string | null;
  color: string | null;
  cilindraje: string | null;
  combustible: string | null;
  carroceria: string | null;
  organismoTransito: string | null;
  fechaMatricula: string | null;
  estado: string | null;
  vin: string | null;
  numeroMotor: string | null;
  numeroChasis: string | null;
  regrabados: { chasis: boolean | null; motor: boolean | null; serie: boolean | null; vin: boolean | null };
  tieneGravamenes: boolean | null;
  tienePrendas: boolean | null;
  limitaciones: Limitacion[];
  /** Solo el conteo: el detalle trae nombres y documentos de terceros. */
  garantiasMobiliarias: number;
  blindado: boolean | null;
  repotenciado: boolean | null;
  desintegrado: boolean;
  dian: { validacion: string | null; visible: boolean };
  soat: Vigencia[];
  rtm: Vigencia[];
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

export type NivelGeneral = 'sin_alertas' | 'con_observaciones' | 'revision_recomendada' | 'atencion_prioritaria';

export interface Conclusion {
  nivel: NivelGeneral;
  titulo: string;
  descripcion: string;
  /** Verificaciones en "revision" o "alerta". */
  aspectosAtencion: number;
  noDisponibles: number;
}

export interface FilaEvidencia {
  etiqueta: string;
  valor: string;
}

export interface Informe {
  id: string;
  codigoVerificacion: string;
  versiones: { reglas: string; plantilla: string };
  generadoEn: string;
  venceEn: string;
  vehiculo: {
    placa: string;
    descripcion: string;
    ficha: FilaEvidencia[];
  };
  conclusion: Conclusion;
  verificaciones: Verificacion[];
  hallazgos: Hallazgo[];
  proximosPasos: string[];
  metodologia: string[];
  evidencia: {
    soat: Vigencia[];
    rtm: Vigencia[];
  };
}
