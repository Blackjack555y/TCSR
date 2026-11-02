import type { Informe } from '../dominio/tipos.js';
import type { TipoDocumento } from '../placapi/tipos.js';

export type EstadoSistema = 'en_curso' | 'generando_pdf' | 'completada' | 'error' | 'vencida';

/** Errores que ve el usuario. Son estados del sistema, distintos de los niveles del informe. */
export type CodigoErrorSistema =
  | 'documento_no_coincide'
  | 'sin_resultados'
  | 'fuente_caida'
  | 'servicio_no_disponible'
  | 'error_interno';

export interface Consulta {
  id: string;
  placa: string;
  docType: TipoDocumento;
  /** HMAC del documento del propietario. El documento en claro nunca se guarda. */
  docHash: string;
  estado: EstadoSistema;
  creadaEn: string;
  actualizadaEn: string;
  consentimiento: { version: string; aceptadoEn: string; ipHash: string };
  error?: { codigo: CodigoErrorSistema; reintentable: boolean };
  informe?: Informe;
  pdfClave?: string;
  /** Hasta cuándo se puede ver y descargar el PDF. */
  venceEn?: string;
  creditosEstimados?: number;
}

export const MENSAJES_ERROR: Record<CodigoErrorSistema, { titulo: string; mensaje: string }> = {
  documento_no_coincide: {
    titulo: 'El documento no coincide con el propietario',
    mensaje: 'El RUNT no reconoce ese documento como el del propietario actual de este vehículo. Confírmalo con el vendedor: si no es el dueño registrado, tenlo en cuenta antes de comprar.'
  },
  sin_resultados: {
    titulo: 'No encontramos información suficiente',
    mensaje: 'No hay registros para esta placa en las fuentes consultadas. Revisa que esté bien escrita.'
  },
  fuente_caida: {
    titulo: 'Una fuente no está disponible en este momento',
    mensaje: 'Uno de los registros que consultamos no respondió a tiempo. Intenta de nuevo en unos minutos.'
  },
  servicio_no_disponible: {
    titulo: 'El servicio no está disponible',
    mensaje: 'No pudimos hacer la consulta por un problema de nuestro lado. Ya lo estamos revisando. Intenta más tarde.'
  },
  error_interno: {
    titulo: 'No pudimos completar la consulta',
    mensaje: 'Algo falló de nuestro lado. Intenta de nuevo en unos minutos.'
  }
};
