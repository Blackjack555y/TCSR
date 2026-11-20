import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aplicar, extraer, validarTexto } from '../scripts/contenido.js';
import { RANGOS } from '../src/precios/catalogo.js';

const html = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
const json = JSON.parse(readFileSync(new URL('../../frontend/contenido/landing.json', import.meta.url), 'utf8'));

describe('contenido de la landing', () => {
  it('el JSON y la página están sincronizados', () => {
    expect(extraer(html)).toEqual(json);
    expect(aplicar(html, json)).toBe(html);
  });

  it('cambiar un texto solo cambia ese texto', () => {
    const nuevo = aplicar(html, { ...json, 'hero.etiqueta': 'Otro texto' });
    expect(nuevo).toContain('data-cms="hero.etiqueta" class="eyebrow">Otro texto</p>');
    expect(nuevo.length - html.length).toBe('Otro texto'.length - json['hero.etiqueta'].length);
  });

  it('los precios de la landing salen del catálogo del backend', () => {
    const full1 = `$ ${new Intl.NumberFormat('es-CO').format(RANGOS[0]!.precios.full)}`;
    const celdas = [...html.matchAll(/data-precio="full:0"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(celdas).toHaveLength(2); // tarjeta y tabla
    expect(celdas.every((c) => c === full1)).toBe(true);
  });

  it('rechaza HTML peligroso o claves que no existen', () => {
    expect(() => validarTexto('x', 'hola <script>alert(1)</script>')).toThrow(/no permitida/);
    expect(() => validarTexto('x', '<img src=x onerror=alert(1)>')).toThrow(/no permitida/);
    expect(() => validarTexto('x', '<a href="javascript:alert(1)">x</a>')).toThrow();
    expect(validarTexto('x', 'Texto con <strong>énfasis</strong> y <span class="grad">color</span>')).toBeTruthy();
    expect(() => aplicar(html, { ...json, 'no.existe': 'x' })).toThrow(/no usa/);
    const { ['hero.titulo']: _quitado, ...incompleto } = json;
    expect(() => aplicar(html, incompleto)).toThrow(/Falta/);
  });
});
