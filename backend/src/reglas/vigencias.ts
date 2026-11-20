import type { Vigencia } from '../dominio/tipos.js';
import { diasEntre, sumarDias } from './fechas.js';

/** Un hueco de más de este número de días entre vigencias se reporta. */
export const UMBRAL_HUECO_DIAS = 30;
/** Si la vigencia actual vence en este número de días o menos, requiere revisión. */
export const UMBRAL_POR_VENCER_DIAS = 30;

export interface Hueco {
  desde: string;
  hasta: string;
  dias: number;
}

export interface AnalisisVigencias {
  /** Vigencias con fechas válidas, ordenadas por fecha de inicio. */
  registros: Vigencia[];
  actual: Vigencia | null;
  /** Fecha de fin más reciente. */
  ultimoVencimiento: string | null;
  diasParaVencer: number | null;
  huecos: Hueco[];
}

/**
 * Analiza el historial de SOAT o RTM respecto a una fecha.
 * Solo reporta huecos entre registros (no antes del primero: el historial del RUNT
 * puede no incluir los años más antiguos) y a partir de `desdeObligacion`.
 */
export function analizarVigencias(vigencias: Vigencia[], hoy: string, desdeObligacion?: string): AnalisisVigencias {
  const registros = vigencias
    .filter((v): v is Vigencia & { desde: string; hasta: string } => !!v.desde && !!v.hasta)
    .sort((a, b) => a.desde.localeCompare(b.desde));

  const actual = registros.find((v) => v.desde <= hoy && hoy <= v.hasta) ?? null;
  const ultimoVencimiento = registros.reduce<string | null>((max, v) => (!max || v.hasta > max ? v.hasta : max), null);

  const huecos: Hueco[] = [];
  let cubiertoHasta: string | null = null;
  for (const v of registros) {
    if (cubiertoHasta) {
      const dias = diasEntre(cubiertoHasta, v.desde) - 1;
      if (dias > UMBRAL_HUECO_DIAS) {
        const desde = sumarDias(cubiertoHasta, 1);
        if (!desdeObligacion || desde >= desdeObligacion) {
          huecos.push({ desde, hasta: sumarDias(v.desde, -1), dias });
        }
      }
    }
    if (!cubiertoHasta || v.hasta > cubiertoHasta) cubiertoHasta = v.hasta;
  }

  return {
    registros,
    actual,
    ultimoVencimiento,
    diasParaVencer: actual ? diasEntre(hoy, actual.hasta) : null,
    huecos
  };
}
