// Errores de PlacApi traducidos a lo que el producto necesita distinguir.
// Códigos documentados en https://placapi.com/openapi.json (respuestas de /consulta).

export type CodigoErrorFuente =
  | 'documento_no_coincide'   // 404 propietario_no_coincide: el documento no es del propietario activo
  | 'sin_resultados'          // 404 vehiculo_no_registrado / consulta_sin_resultado
  | 'datos_invalidos'         // 400
  | 'sin_creditos'            // 402: problema nuestro, no del usuario
  | 'no_autorizado'           // 401: API key inválida, problema nuestro
  | 'limite_peticiones'       // 429
  | 'fuente_caida'            // 502 / 503 / timeout
  | 'error_interno';          // 500 u otro

export class ErrorFuente extends Error {
  constructor(
    readonly codigo: CodigoErrorFuente,
    readonly status: number | null,
    readonly codigoProveedor: string | null
  ) {
    super(`PlacApi: ${codigo}${codigoProveedor ? ` (${codigoProveedor})` : ''}`);
    this.name = 'ErrorFuente';
  }

  /** Si tiene sentido que el usuario lo intente de nuevo más tarde. */
  get reintentable(): boolean {
    return this.codigo === 'fuente_caida' || this.codigo === 'limite_peticiones' || this.codigo === 'error_interno';
  }
}

export function traducirError(status: number, codigoProveedor: string | null): ErrorFuente {
  const c = codigoProveedor;
  if (status === 404) {
    if (c === 'propietario_no_coincide') return new ErrorFuente('documento_no_coincide', status, c);
    return new ErrorFuente('sin_resultados', status, c);
  }
  if (status === 400) return new ErrorFuente('datos_invalidos', status, c);
  if (status === 401 || status === 403) return new ErrorFuente('no_autorizado', status, c);
  if (status === 402) return new ErrorFuente('sin_creditos', status, c);
  if (status === 429) return new ErrorFuente('limite_peticiones', status, c);
  if (status === 502 || status === 503 || status === 504) return new ErrorFuente('fuente_caida', status, c);
  return new ErrorFuente('error_interno', status, c);
}
