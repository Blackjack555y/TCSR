import type { Config } from '../config.js';
import { ClientePlacApi } from './cliente.js';
import { FuenteSimulada } from './simulado.js';
import type { FuenteVehicular } from './tipos.js';

export function crearFuente(config: Config): FuenteVehicular {
  if (config.PLACAPI_MODO === 'real') {
    return new ClientePlacApi({
      url: config.PLACAPI_URL,
      apiKey: config.PLACAPI_KEY!,
      timeoutMs: config.PLACAPI_TIMEOUT_MS
    });
  }
  return new FuenteSimulada();
}

export * from './tipos.js';
export * from './errores.js';
