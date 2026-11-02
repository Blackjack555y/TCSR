import { ErrorFuente, traducirError } from './errores.js';
import type { FuenteVehicular, ParametrosConsulta, RawConsultaRunt } from './tipos.js';

interface Opciones {
  url: string;
  apiKey: string;
  timeoutMs: number;
}

/** Cliente real de PlacApi. La API key solo vive en el servidor. */
export class ClientePlacApi implements FuenteVehicular {
  constructor(private readonly opciones: Opciones) {}

  consultarRunt(p: ParametrosConsulta): Promise<RawConsultaRunt> {
    return this.post<RawConsultaRunt>('/consulta', p);
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
