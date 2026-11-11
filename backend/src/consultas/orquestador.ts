import type { Bloque, DatosConsulta, TipoInforme } from '../dominio/tipos.js';
import { bloque, normalizarAvaluo, normalizarFull, normalizarGarantias, normalizarHurto, normalizarSiniestros } from '../normalizacion/fuentes.js';
import { normalizarRunt } from '../normalizacion/runt.js';
import { ErrorFuente, type FuenteVehicular, type ParametrosFull, type RespuestaBloque } from '../placapi/index.js';

export type EntradaInforme =
  | { tipo: 'basico'; placa: string }
  | { tipo: 'vin'; vin: string }
  | ({ tipo: 'full' } & ParametrosFull);

const NO_CONSULTADA = { estado: 'no_consultada' } as const;

/** Créditos que cobra PlacApi por cada llamada que responde (consulta con datos). */
export const COSTO_CREDITOS = {
  consultaFull: 3, consultaPorVin: 1, avaluoPorVin: 1, reporteHurto: 1, perdidaTotal: 2, garantiasRgm: 1
} as const;

/** Envuelve la fuente para contar los créditos de las llamadas que respondieron. */
function conConteo(fuente: FuenteVehicular) {
  const cuenta = { creditos: 0 };
  const envuelta = new Proxy(fuente, {
    get(obj, clave: string) {
      const original = (obj as unknown as Record<string, unknown>)[clave];
      if (typeof original !== 'function' || !(clave in COSTO_CREDITOS)) return original;
      return async (...args: unknown[]) => {
        const r = (await (original as (...a: unknown[]) => Promise<unknown>).apply(obj, args)) as { cost?: unknown; fromCache?: unknown } | null;
        // PlacApi informa lo que cobró: un acierto de caché no cuesta. Si no lo dice, se usa la tarifa.
        cuenta.creditos += r?.fromCache === true ? 0
          : typeof r?.cost === 'number' ? r.cost
          : COSTO_CREDITOS[clave as keyof typeof COSTO_CREDITOS];
        return r;
      };
    }
  });
  return { envuelta, cuenta };
}

/** Si el problema es nuestro (sin créditos, API key), no se entrega un informe parcial. */
function esProblemaPropio(e: unknown): e is ErrorFuente {
  return e instanceof ErrorFuente && (e.codigo === 'sin_creditos' || e.codigo === 'no_autorizado' || e.codigo === 'datos_invalidos');
}

function resolver<R, T>(r: PromiseSettledResult<RespuestaBloque<R>>, mapear: (d: R) => T): Bloque<T> {
  if (r.status === 'fulfilled') return bloque(r.value, mapear);
  if (esProblemaPropio(r.reason)) throw r.reason;
  if (r.reason instanceof ErrorFuente && r.reason.codigo === 'sin_resultados') return { estado: 'no_cubierta' };
  return { estado: 'error' };
}

async function complementarias(fuente: FuenteVehicular, placa: string) {
  const [hurto, siniestros] = await Promise.allSettled([fuente.reporteHurto(placa), fuente.perdidaTotal(placa)]);
  return {
    hurto: resolver(hurto, normalizarHurto),
    siniestros: resolver(siniestros, normalizarSiniestros)
  };
}

async function full(fuente: FuenteVehicular, e: Extract<EntradaInforme, { tipo: 'full' }>): Promise<DatosConsulta> {
  // Primero la consulta principal: si el documento no coincide, no se gastan más créditos.
  const raw = await fuente.consultaFull({ placa: e.placa, docType: e.docType, docNumber: e.docNumber });
  const base = normalizarFull(raw);
  if (base.vehiculo.estado !== 'ok') throw new ErrorFuente('fuente_caida', null, null);
  return { tipo: 'full', ...base, ...(await complementarias(fuente, e.placa)) };
}

async function porVin(fuente: FuenteVehicular, vin: string): Promise<DatosConsulta> {
  const raw = await fuente.consultaPorVin(vin);
  if (!raw.data) throw new ErrorFuente('sin_resultados', null, null);
  const vehiculo = normalizarRunt(raw);

  const [avaluo, comp] = await Promise.all([
    Promise.allSettled([fuente.avaluoPorVin(vin)]),
    vehiculo.placa ? complementarias(fuente, vehiculo.placa) : null
  ]);
  return {
    tipo: 'vin',
    placa: vehiculo.placa || null,
    vehiculo: { estado: 'ok', datos: vehiculo, consultadoEn: raw.fetchedAt ?? null },
    soatDisponible: true,
    rtmDisponible: true,
    legalDisponible: true,
    prendas: NO_CONSULTADA,
    multas: NO_CONSULTADA,
    impuestos: NO_CONSULTADA,
    historial: NO_CONSULTADA,
    avaluo: resolver(avaluo[0]!, normalizarAvaluo),
    hurto: comp?.hurto ?? { estado: 'error' },
    siniestros: comp?.siniestros ?? { estado: 'error' }
  };
}

async function basico(fuente: FuenteVehicular, placa: string): Promise<DatosConsulta> {
  const [hurto, siniestros, prendas] = await Promise.allSettled([
    fuente.reporteHurto(placa), fuente.perdidaTotal(placa), fuente.garantiasRgm(placa)
  ]);
  // Si no respondió ninguna, no hay informe que entregar.
  if (hurto.status === 'rejected' && siniestros.status === 'rejected' && prendas.status === 'rejected') {
    throw hurto.reason;
  }
  return {
    tipo: 'basico',
    placa,
    vehiculo: NO_CONSULTADA,
    soatDisponible: false,
    rtmDisponible: false,
    legalDisponible: false,
    prendas: resolver(prendas, normalizarGarantias),
    multas: NO_CONSULTADA,
    impuestos: NO_CONSULTADA,
    historial: NO_CONSULTADA,
    avaluo: NO_CONSULTADA,
    hurto: resolver(hurto, normalizarHurto),
    siniestros: resolver(siniestros, normalizarSiniestros)
  };
}

export function obtenerDatos(fuente: FuenteVehicular, e: EntradaInforme): Promise<DatosConsulta> {
  switch (e.tipo) {
    case 'full': return full(fuente, e);
    case 'vin': return porVin(fuente, e.vin);
    case 'basico': return basico(fuente, e.placa);
  }
}

/** Igual que obtenerDatos, y además informa los créditos gastados (también si falla). */
export async function obtenerDatosConCreditos(fuente: FuenteVehicular, e: EntradaInforme) {
  const { envuelta, cuenta } = conConteo(fuente);
  try {
    return { datos: await obtenerDatos(envuelta, e), creditos: cuenta.creditos };
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { creditos: cuenta.creditos });
  }
}

export type { TipoInforme };
