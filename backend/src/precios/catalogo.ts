import type { TipoInforme } from '../dominio/tipos.js';

// Precios finales por informe, con IVA, en COP. El precio unitario depende de la
// cantidad de cada compra (no del mes) y aplica a todas las unidades de esa compra.

export interface Rango {
  segmento: string;
  desde: number;
  hasta: number | null;
  precios: Record<TipoInforme, number>;
}

export const RANGOS: Rango[] = [
  { segmento: 'Comprador / Vendedor', desde: 1, hasta: 5, precios: { basico: 22_500, vin: 37_000, full: 45_000 } },
  { segmento: 'Dealer / Revendedor', desde: 6, hasta: 50, precios: { basico: 17_500, vin: 29_000, full: 35_000 } },
  { segmento: 'Mayorista', desde: 51, hasta: 200, precios: { basico: 11_000, vin: 18_500, full: 22_000 } },
  { segmento: 'Flotas', desde: 201, hasta: null, precios: { basico: 10_000, vin: 16_500, full: 20_000 } }
];

export const CANTIDAD_MAXIMA = 10_000;

/** Créditos de PlacApi que gasta cada informe. */
export const CREDITOS_POR_INFORME: Record<TipoInforme, number> = { basico: 4, vin: 5, full: 6 };

export interface Cotizacion {
  tipo: TipoInforme;
  cantidad: number;
  segmento: string;
  precioUnitario: number;
  total: number;
  /** Si comprar más sale más barato en total (por ejemplo 6 cuestan menos que 5). */
  mejorOpcion: { cantidad: number; precioUnitario: number; total: number; ahorro: number } | null;
}

function rangoDe(cantidad: number): Rango {
  const r = RANGOS.find((x) => cantidad >= x.desde && (x.hasta === null || cantidad <= x.hasta));
  if (!r) throw new RangeError(`Cantidad fuera de rango: ${cantidad}`);
  return r;
}

export function cotizar(tipo: TipoInforme, cantidad: number): Cotizacion {
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > CANTIDAD_MAXIMA) {
    throw new RangeError(`Cantidad inválida: ${cantidad}`);
  }
  const rango = rangoDe(cantidad);
  const precioUnitario = rango.precios[tipo];
  const total = precioUnitario * cantidad;

  let mejorOpcion: Cotizacion['mejorOpcion'] = null;
  for (const r of RANGOS) {
    if (r.desde <= cantidad) continue;
    const totalAlterno = r.precios[tipo] * r.desde;
    if (totalAlterno < (mejorOpcion?.total ?? total)) {
      mejorOpcion = { cantidad: r.desde, precioUnitario: r.precios[tipo], total: totalAlterno, ahorro: total - totalAlterno };
    }
  }
  return { tipo, cantidad, segmento: rango.segmento, precioUnitario, total, mejorOpcion };
}
