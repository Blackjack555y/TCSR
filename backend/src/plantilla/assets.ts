import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Todo se incrusta como data URI: el render no depende de la red (Google Fonts, CDN...).

const require = createRequire(import.meta.url);
const ASSETS = new URL('../../assets/', import.meta.url);

const fuente = (pkg: string, archivo: string) =>
  readFileSync(require.resolve(`${pkg}/files/${archivo}`)).toString('base64');

const imagen = (archivo: string) => readFileSync(new URL(archivo, ASSETS)).toString('base64');

let cache: string | null = null;

/** Reglas @font-face con Sora (títulos) e Inter (cuerpo) incrustadas. */
export function cssFuentes(): string {
  if (cache) return cache;
  const caras: [string, string, number][] = [
    ['@fontsource/inter', 'inter-latin-400-normal.woff2', 400],
    ['@fontsource/inter', 'inter-latin-500-normal.woff2', 500],
    ['@fontsource/inter', 'inter-latin-600-normal.woff2', 600],
    ['@fontsource/sora', 'sora-latin-700-normal.woff2', 700],
    ['@fontsource/sora', 'sora-latin-800-normal.woff2', 800]
  ];
  cache = caras
    .map(([pkg, archivo, peso]) => {
      const familia = pkg.endsWith('sora') ? 'Sora' : 'Inter';
      return `@font-face{font-family:'${familia}';font-weight:${peso};font-style:normal;src:url(data:font/woff2;base64,${fuente(pkg, archivo)}) format('woff2');}`;
    })
    .join('\n');
  return cache;
}

let logos: { icono: string; nombre: string } | null = null;

export function logosDataUri() {
  logos ??= {
    icono: `data:image/png;base64,${imagen('logo-icono.png')}`,
    nombre: `data:image/png;base64,${imagen('logo-nombre.png')}`
  };
  return logos;
}
