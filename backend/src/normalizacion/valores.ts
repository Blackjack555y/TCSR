// Utilidades para los formatos mezclados de las fuentes: fechas dd/mm/aaaa e ISO,
// "SI"/"NO" junto a booleanos, textos con espacios sobrantes y cadenas vacías.

export function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t === '' ? null : t;
}

export function siNo(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  const t = texto(v)?.toUpperCase();
  if (t === 'SI' || t === 'SÍ' || t === 'S') return true;
  if (t === 'NO' || t === 'N') return false;
  return null;
}

/** Devuelve la fecha como yyyy-mm-dd, o null si no se reconoce. */
export function fecha(v: unknown): string | null {
  const t = texto(v);
  if (!t) return null;

  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (dmy) {
    const [, d, m, y] = dmy;
    return valida(`${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return valida(iso[0]);
  return null;
}

function valida(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function entero(v: unknown): number | null {
  const t = texto(typeof v === 'number' ? String(v) : v);
  if (!t || !/^\d+$/.test(t)) return null;
  return Number(t);
}
