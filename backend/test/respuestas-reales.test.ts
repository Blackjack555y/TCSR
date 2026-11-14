// Respuestas reales de PlacApi (anonimizadas): la normalización y las reglas deben entender su forma exacta.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { obtenerDatosConCreditos } from '../src/consultas/orquestador.js';
import { armarInforme } from '../src/informe/armar.js';
import type { FuenteVehicular } from '../src/placapi/index.js';

const leer = (n: string) => {
  const j = JSON.parse(readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url), 'utf8'));
  delete j._nota;
  return j;
};

/** Primera llamada en vivo; las repetidas vienen del caché, como pasó en la prueba real. */
function fuenteReal(): FuenteVehicular {
  const vistas = new Set<string>();
  const responder = (nombre: string) => async () => {
    const r = leer(nombre);
    if (vistas.has(nombre)) Object.assign(r, { fromCache: true, cost: 0 });
    vistas.add(nombre);
    return r;
  };
  return {
    consultaFull: async () => { throw new Error('sin respuesta real todavía'); },
    consultaPorVin: responder('real-consulta-por-vin'),
    avaluoPorVin: responder('real-avaluo-por-vin'),
    reporteHurto: responder('real-reporte-hurto'),
    perdidaTotal: responder('real-perdida-total'),
    garantiasRgm: responder('real-garantias-rgm')
  };
}

const AHORA = new Date('2026-11-11T23:45:00Z');

describe('respuestas reales de PlacApi', () => {
  it('informe Por VIN de una moto nueva', async () => {
    const { datos } = await obtenerDatosConCreditos(fuenteReal(), { tipo: 'vin', vin: '9FKRE0000T0000001' });
    const i = armarInforme(datos, { ahora: AHORA, diasVigencia: 7 });
    const ver = (id: string) => i.verificaciones.find((v) => v.id === id);
    expect(i.vehiculo.placa).toBe('XYZ12A');
    expect(i.vehiculo.descripcion).toBe('YAMAHA YC110D (YC-Z) · Modelo 2026 · Motocicleta');
    expect(ver('soat')).toMatchObject({ nivel: 'sin_hallazgos', valor: 'Vigente hasta el 14/03/2027' });
    expect(ver('rtm')?.valor).toBe('Aún no es obligatoria (primera revisión antes del 15/03/2027)');
    expect(ver('avaluo')?.valor).toBe('$ 6.300.000');
    expect(ver('validacion_dian')).toBeUndefined(); // el RUNT no la muestra
    expect(i.parcial).toBe(false);
    // Sin reclamaciones a aseguradoras no descarta un salvamento: requiere revisión.
    expect(ver('siniestros')?.nivel).toBe('revision');
    expect(i.conclusion.nivel).toBe('revision_recomendada');
  });

  it('informe Básico', async () => {
    const { datos, creditos } = await obtenerDatosConCreditos(fuenteReal(), { tipo: 'basico', placa: 'XYZ12A' });
    const i = armarInforme(datos, { ahora: AHORA, diasVigencia: 7 });
    expect(i.verificaciones.filter((v) => v.consulta === 'ok').map((v) => v.id).sort()).toEqual(['hurto', 'prendas', 'siniestros']);
    expect(creditos).toBe(4);
  });

  it('las llamadas que vienen del caché no se cuentan como gasto', async () => {
    const f = fuenteReal();
    await obtenerDatosConCreditos(f, { tipo: 'basico', placa: 'XYZ12A' });
    // Hurto y pérdida total ya están en caché: solo cobran la ficha y el avalúo.
    expect((await obtenerDatosConCreditos(f, { tipo: 'vin', vin: '9FKRE0000T0000001' })).creditos).toBe(2);
  });
});
