// Textos editables de la landing.
//   npm run contenido:extraer   → escribe frontend/contenido/landing.json con los textos actuales.
//   npm run contenido:aplicar   → escribe el JSON en frontend/index.html y llena los precios desde el catálogo.
// Los elementos editables llevan data-cms="clave"; los precios, data-precio="tipo:rango".
// Solo se reemplaza el contenido de esos elementos: el resto del HTML queda igual.

import { readFileSync, writeFileSync } from 'node:fs';
import { parse, type HTMLElement } from 'node-html-parser';
import type { TipoInforme } from '../src/dominio/tipos.js';
import { RANGOS } from '../src/precios/catalogo.js';

const HTML = new URL('../../frontend/index.html', import.meta.url);
const JSON_CONTENIDO = new URL('../../frontend/contenido/landing.json', import.meta.url);

/** Etiquetas permitidas dentro de un texto: solo formato en línea. */
const ETIQUETAS_PERMITIDAS = /^<\/?(strong|em|br|span( class="grad")?|a( href="[^"<>]*")?)\s*\/?>$/i;

export function validarTexto(clave: string, valor: unknown): string {
  if (typeof valor !== 'string') throw new Error(`"${clave}" debe ser texto`);
  for (const etiqueta of valor.match(/<[^>]*>/g) ?? []) {
    if (!ETIQUETAS_PERMITIDAS.test(etiqueta)) throw new Error(`"${clave}" tiene una etiqueta no permitida: ${etiqueta}`);
  }
  if (/javascript:/i.test(valor)) throw new Error(`"${clave}" tiene un enlace no permitido`);
  return valor;
}

const pesos = (n: number) => `$ ${new Intl.NumberFormat('es-CO').format(n)}`;

function contenidoDe(original: string, el: HTMLElement) {
  const abre = original.indexOf('>', el.range[0]) + 1;
  const cierra = original.lastIndexOf('</', el.range[1] - 1);
  return { abre, cierra, html: original.slice(abre, cierra) };
}

export function extraer(original: string): Record<string, string> {
  const raiz = parse(original);
  const salida: Record<string, string> = {};
  for (const el of raiz.querySelectorAll('[data-cms]')) {
    salida[el.getAttribute('data-cms')!] = contenidoDe(original, el).html.trim();
  }
  return salida;
}

export function aplicar(original: string, textos: Record<string, unknown>): string {
  const raiz = parse(original);
  const ediciones: { abre: number; cierra: number; texto: string }[] = [];
  const claves = new Set<string>();

  for (const el of raiz.querySelectorAll('[data-cms]')) {
    const clave = el.getAttribute('data-cms')!;
    claves.add(clave);
    if (!(clave in textos)) throw new Error(`Falta el texto "${clave}" en el JSON`);
    const { abre, cierra } = contenidoDe(original, el);
    ediciones.push({ abre, cierra, texto: validarTexto(clave, textos[clave]) });
  }
  const sobran = Object.keys(textos).filter((k) => !claves.has(k));
  if (sobran.length) throw new Error(`El JSON tiene claves que la página no usa: ${sobran.join(', ')}`);

  for (const el of raiz.querySelectorAll('[data-precio]')) {
    const [tipo, rango] = el.getAttribute('data-precio')!.split(':') as [TipoInforme, string];
    const r = RANGOS[Number(rango)];
    if (!r || !(tipo in r.precios)) throw new Error(`Precio desconocido: ${el.getAttribute('data-precio')}`);
    const { abre, cierra } = contenidoDe(original, el);
    ediciones.push({ abre, cierra, texto: pesos(r.precios[tipo]) });
  }

  let html = original;
  for (const e of ediciones.sort((a, b) => b.abre - a.abre)) html = html.slice(0, e.abre) + e.texto + html.slice(e.cierra);
  return html;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const accion = process.argv[2];
  const original = readFileSync(HTML, 'utf8');
  if (accion === 'extraer') {
    const textos = extraer(original);
    writeFileSync(JSON_CONTENIDO, JSON.stringify(textos, null, 2) + '\n');
    console.log(`${Object.keys(textos).length} textos en frontend/contenido/landing.json`);
  } else if (accion === 'aplicar') {
    const html = aplicar(original, JSON.parse(readFileSync(JSON_CONTENIDO, 'utf8')));
    writeFileSync(HTML, html);
    console.log(html === original ? 'Sin cambios: la página ya tenía esos textos y precios.' : 'Textos y precios aplicados en frontend/index.html');
  } else {
    console.error('Uso: tsx scripts/contenido.ts extraer|aplicar');
    process.exit(1);
  }
}
