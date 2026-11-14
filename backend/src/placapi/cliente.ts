import { ErrorFuente, traducirError } from './errores.js';
import type { FuenteVehicular, ParametrosFull, RawAccidentes, RawAvaluo, RawConsultaRunt, RawFull, RawGarantias, RawHurto, RawSiniestros, RespuestaBloque } from './tipos.js';

interface Opciones {
  url: string;
  apiKey: string;
  timeoutMs: number;
}

/** Cliente real de PlacApi. La API key solo vive en el servidor. */
export class ClientePlacApi implements FuenteVehicular {
  constructor(private readonly opciones: Opciones) {}

  consultaFull(p: ParametrosFull) {
    return this.post<RawFull>('/consulta-full', p);
  }

  consultaPorVin(vin: string) {
    return this.post<RawConsultaRunt>('/consulta-por-vin', { vin });
  }

  avaluoPorVin(vin: string) {
    return this.post<RespuestaBloque<RawAvaluo>>('/avaluo-por-vin', { vin });
  }

  reporteHurto(placa: string) {
    return this.post<RespuestaBloque<RawHurto>>('/reporte-hurto', { placa });
  }

  perdidaTotal(placa: string) {
    return this.post<RespuestaBloque<RawSiniestros>>('/perdida-total', { placa });
  }

  garantiasRgm(placa: string) {
    return this.post<RespuestaBloque<RawGarantias>>('/garantias-rgm', { placa });
  }

  accidentesBogota(placa: string) {
    return this.post<RespuestaBloque<RawAccidentes>>('/accidentes-bogota', { placa });
  }

  private async post<T>(ruta: string, cuerpo: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.opciones.url}${ruta}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.opciones.apiKey },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(this.opciones.timeoutMs)
      });
    } catch {
      // timeout o red caída
      throw new ErrorFuente('fuente_caida', null, null);
    }

    if (res.ok) return (await res.json()) as T;

    let codigo: string | null = null;
    try {
      const body = (await res.json()) as { code?: string; error?: { code?: string } | string };
      codigo = body.code ?? (typeof body.error === 'object' ? body.error?.code : body.error) ?? null;
    } catch {
      // cuerpo vacío o no JSON
    }
    throw traducirError(res.status, codigo);
  }
}
