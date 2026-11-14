// Modelo propio de Carro Sin Rollos. Nada de aquí depende de la forma en que
// responde PlacApi: la capa de normalización traduce hacia estos tipos.

/** Los tres informes que se venden. Cada compra sirve para un solo tipo. */
export type TipoInforme = 'basico' | 'vin' | 'full';

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
  | 'accidentes'
  | 'propietarios'
  | 'avaluo'
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
  /** null si la fuente no permite saberlo. */
  desintegrado: boolean | null;
  dian: { validacion: string | null; visible: boolean };
  soat: Vigencia[];
  rtm: Vigencia[];
  /** La fuente indica que aún no le toca revisión técnico-mecánica. */
  rtmExento?: boolean;
  /** Matriculado antes del 19-may-2023 y entre los años 5 y 6: la obligación de la primera revisión está en discusión. */
  rtmEnDisputa?: boolean;
}

export interface Prenda {
  /** Razón social. Si parece una persona natural, se enmascara. */
  acreedor: string;
  fecha: string | null;
}

export interface Hurto {
  denunciaActiva: boolean;
  reportado: boolean;
  totalRegistros: number;
  extincionDominio: number;
  /** Solo categoría, estado y fecha: sin noticia criminal ni datos de personas. */
  registros: { categoria: string | null; fecha: string | null; estado: string | null }[];
}

export interface Siniestros {
  perdidaTotal: boolean;
  total: number;
  registros: { fecha: string | null; amparo: string | null; severidad: string | null }[];
}

/** Accidentes reportados en Bogotá (informes IPAT): solo fecha y gravedad. */
export interface Accidentes {
  total: number;
  /** solo_danos, con_heridos o con_muertos; null si no hay registros. */
  gravedadMaxima: string | null;
  registros: { fecha: string | null; gravedad: string | null }[];
}

export interface Multas {
  totalDeuda: number;
  totalMultas: number;
  acuerdosPago: number;
}

export interface Impuestos {
  departamento: string | null;
  totalPendiente: number;
  aniosPendientes: number[];
  /** Hay deuda, pero la gobernación no publica el monto. */
  deudaSinMonto: boolean;
}

export interface Historial {
  propietarios: number | null;
  /** Fechas ISO de los traspasos registrados. */
  traspasos: string[];
}

export interface Avaluo {
  aproximado: boolean;
  valorComercial: number;
  rango: { min: number; max: number } | null;
}

/** Resultado de una fuente: el dato, o por qué no lo tenemos. */
export type Bloque<T> =
  | { estado: 'ok'; datos: T; consultadoEn: string | null }
  | { estado: 'error' | 'no_consultada' | 'no_cubierta'; consultadoEn?: string | null };

/** Todo lo que se obtuvo para un informe, ya normalizado. */
export interface DatosConsulta {
  tipo: TipoInforme;
  placa: string | null;
  vehiculo: Bloque<VehiculoRunt>;
  /** Partes de la ficha que fallaron por separado: nunca se tratan como "no tiene". */
  soatDisponible: boolean;
  rtmDisponible: boolean;
  legalDisponible: boolean;
  prendas: Bloque<Prenda[]>;
  hurto: Bloque<Hurto>;
  siniestros: Bloque<Siniestros>;
  accidentes: Bloque<Accidentes>;
  multas: Bloque<Multas>;
  impuestos: Bloque<Impuestos>;
  historial: Bloque<Historial>;
  avaluo: Bloque<Avaluo>;
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
  tipo: TipoInforme;
  /** Alguna fuente falló: el informe se entrega con esas verificaciones como no disponibles. */
  parcial: boolean;
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
    traspasos: string[];
    siniestros: Siniestros['registros'];
    accidentes: Accidentes['registros'];
    hurto: Hurto['registros'];
  };
}
