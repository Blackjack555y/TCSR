const DIA_MS = 86_400_000;

const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Fecha de hoy en Colombia, como yyyy-mm-dd. */
export function hoyColombia(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora);
}

/** Días de a hasta b (positivo si b es posterior). */
export function diasEntre(a: string, b: string): number {
  return Math.round((ms(b) - ms(a)) / DIA_MS);
}

export function sumarDias(iso: string, dias: number): string {
  return new Date(ms(iso) + dias * DIA_MS).toISOString().slice(0, 10);
}

export function sumarAnios(iso: string, anios: number): string {
  const [y, m, d] = iso.split('-');
  return `${Number(y) + anios}-${m}-${d}`;
}

/** yyyy-mm-dd → dd/mm/aaaa */
export function fechaCorta(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** yyyy-mm-dd → "noviembre de 2022" */
export function mesAnio(iso: string): string {
  const [y, m] = iso.split('-');
  return `${MESES[Number(m) - 1]} de ${y}`;
}

/** Duración legible: "3 años y 2 meses", "45 días". */
export function duracion(dias: number): string {
  if (dias < 60) return `${dias} días`;
  const meses = Math.round(dias / 30.44);
  if (meses < 12) return `${meses} meses`;
  const anios = Math.floor(meses / 12);
  const resto = meses % 12;
  const a = anios === 1 ? '1 año' : `${anios} años`;
  return resto === 0 ? a : `${a} y ${resto === 1 ? '1 mes' : `${resto} meses`}`;
}
