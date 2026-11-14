import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DatosConsulta, VehiculoRunt } from '../src/dominio/tipos.js';
import { armarInforme, concluir } from '../src/informe/armar.js';
import { normalizarRunt } from '../src/normalizacion/runt.js';
import { fecha, siNo, texto } from '../src/normalizacion/valores.js';
import { analizarVigencias } from '../src/reglas/vigencias.js';
import type { RawConsultaRunt } from '../src/placapi/tipos.js';

const raw = JSON.parse(readFileSync(new URL('../fixtures/runt-consulta-abc12d.json', import.meta.url), 'utf8')) as RawConsultaRunt;
// 8 de octubre de 2026, 10:00 en Colombia: el día de la consulta real.
const AHORA = new Date('2026-10-08T15:00:00Z');

const NC = { estado: 'no_consultada' } as const;

const datosDe = (v: VehiculoRunt): DatosConsulta => ({
  tipo: 'vin',
  placa: v.placa,
  vehiculo: { estado: 'ok', datos: v, consultadoEn: '2026-10-08T13:00:55.106Z' },
  soatDisponible: true,
  rtmDisponible: true,
  legalDisponible: true,
  prendas: NC, hurto: NC, siniestros: NC, multas: NC, impuestos: NC, historial: NC, avaluo: NC
});

const informeDe = (v: VehiculoRunt, ahora = AHORA) => armarInforme(datosDe(v), { ahora, diasVigencia: 7 });

describe('normalización', () => {
  it('convierte formatos mezclados', () => {
    expect(fecha('04/09/2013')).toBe('2013-09-04');
    expect(fecha('2013-09-04T11:08:01.000-05:00')).toBe('2013-09-04');
    expect(fecha('31/02/2020')).toBeNull();
    expect(fecha('')).toBeNull();
    expect(siNo('SI')).toBe(true);
    expect(siNo('NO')).toBe(false);
    expect(siNo(false)).toBe(false);
    expect(siNo('NO DISPONIBLE')).toBeNull();
    expect(texto('  CDA   CEDIPLUS ')).toBe('CDA CEDIPLUS');
  });

  it('descarta el documento del propietario', () => {
    const v = normalizarRunt(raw);
    expect(JSON.stringify(v)).not.toContain('1000000001');
    expect(v.placa).toBe('ABC12D');
    expect(v.soat).toHaveLength(5);
    expect(v.rtm[0]?.entidad).toBe('CDA CEDIPLUS SOACHA');
    expect(v.dian.visible).toBe(false);
  });
});

describe('vigencias', () => {
  it('detecta huecos de más de 30 días y no los menores', () => {
    const a = analizarVigencias([
      { desde: '2020-01-01', hasta: '2020-12-31', entidad: null, estadoFuente: null },
      { desde: '2021-01-20', hasta: '2021-12-31', entidad: null, estadoFuente: null }, // 19 días: no
      { desde: '2023-01-01', hasta: '2023-12-31', entidad: null, estadoFuente: null }  // 365 días: sí
    ], '2023-06-01');
    expect(a.huecos).toEqual([{ desde: '2022-01-01', hasta: '2022-12-31', dias: 365 }]);
    expect(a.actual?.desde).toBe('2023-01-01');
    expect(a.diasParaVencer).toBe(213);
  });
});

describe('informe de la moto de ejemplo', () => {
  const informe = informeDe(normalizarRunt(raw));
  const ver = (id: string) => informe.verificaciones.find((v) => v.id === id);

  it('SOAT y RTM requieren revisión: vencen pronto y tienen huecos de casi 3 años', () => {
    expect(ver('soat')).toMatchObject({ nivel: 'revision', valor: 'Vigente hasta el 03/11/2026 (vence en 26 días)' });
    expect(ver('rtm')).toMatchObject({ nivel: 'revision', valor: 'Vigente hasta el 07/11/2026 (vence en 30 días)' });

    const titulos = informe.hallazgos.map((h) => h.titulo);
    expect(titulos).toContain('El SOAT vence en 26 días');
    expect(titulos).toContain('3 años sin SOAT');
    expect(titulos.some((t) => /sin revisión técnico-mecánica$/.test(t))).toBe(true);
  });

  it('lo legal está limpio', () => {
    for (const id of ['estado_matricula', 'gravamenes', 'prendas', 'regrabados', 'desintegracion']) {
      expect(ver(id)?.nivel, id).toBe('sin_hallazgos');
    }
  });

  it('no muestra la DIAN cuando el RUNT no la hace visible', () => {
    expect(ver('validacion_dian')).toBeUndefined();
  });

  it('lo no integrado aparece como no disponible, nunca omitido', () => {
    for (const id of ['multas', 'impuestos', 'hurto', 'siniestros', 'propietarios', 'avaluo', 'antecedentes_propietario']) {
      expect(ver(id)).toMatchObject({ nivel: 'no_disponible', consulta: 'no_consultada' });
    }
  });

  it('concluye "Revisión recomendada" con 2 aspectos', () => {
    expect(informe.conclusion).toMatchObject({ nivel: 'revision_recomendada', aspectosAtencion: 2, noDisponibles: 7 });
  });

  it('vence a los 7 días y lleva código de verificación', () => {
    expect(informe.venceEn).toBe('2026-10-16T04:59:59.000Z'); // 15/10 23:59 en Colombia
    expect(informe.codigoVerificacion).toMatch(/^CSR-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});

describe('reglas con otros escenarios', () => {
  const base = normalizarRunt(raw);

  it('embargo y SOAT vencido → atención prioritaria', () => {
    const informe = informeDe({
      ...base,
      tieneGravamenes: true,
      limitaciones: [{ tipo: 'EMBARGO', entidad: 'JUZGADO 12 CIVIL', fecha: '2025-02-10' }]
    }, new Date('2027-01-15T15:00:00Z'));
    expect(informe.conclusion.nivel).toBe('atencion_prioritaria');
    expect(informe.verificaciones.find((v) => v.id === 'soat')?.nivel).toBe('alerta');
    expect(informe.hallazgos[0]?.nivel).toBe('alerta');
  });

  it('carro particular nuevo sin RTM no es alerta antes de los 5 años', () => {
    const informe = informeDe({ ...base, clasificacion: 'AUTOMOVIL', clase: 'AUTOMOVIL', fechaMatricula: '2023-03-15', rtm: [] });
    expect(informe.verificaciones.find((v) => v.id === 'rtm')?.nivel).toBe('sin_hallazgos');
  });

  it('nunca concluye "sin alertas" si hay datos no disponibles', () => {
    const c = concluir([
      { id: 'soat', nombre: 'SOAT', consulta: 'ok', valor: 'x', nivel: 'sin_hallazgos', fuente: 'RUNT', consultadoEn: null },
      { id: 'multas', nombre: 'Multas', consulta: 'error', valor: null, nivel: 'no_disponible', fuente: 'SIMIT', consultadoEn: null }
    ]);
    expect(c.nivel).toBe('con_observaciones');
  });

  it('lo que siempre está no disponible o es informativo no cambia la conclusión', () => {
    const v = (id: 'soat' | 'avaluo' | 'antecedentes_propietario' | 'propietarios', nivel: 'sin_hallazgos' | 'no_disponible', consulta: 'ok' | 'no_consultada' | 'no_cubierta' | 'error') =>
      ({ id, nombre: id, consulta, valor: null, nivel, fuente: '—', consultadoEn: null });
    const c = concluir([
      v('soat', 'sin_hallazgos', 'ok'),
      v('antecedentes_propietario', 'no_disponible', 'no_consultada'),
      v('propietarios', 'no_disponible', 'no_cubierta'),
      v('avaluo', 'no_disponible', 'error')
    ]);
    expect(c.nivel).toBe('sin_alertas');
    expect(c.noDisponibles).toBe(3); // se siguen mostrando y contando
    expect(c.descripcion).toContain('no disponibles');
  });

  it('RTM en disputa (matrícula antes de mayo 2023, entre 5 y 6 años) requiere revisión, no alerta', () => {
    const coche = { ...base, clasificacion: 'AUTOMOVIL', clase: 'AUTOMOVIL', servicio: 'PARTICULAR', fechaMatricula: '2021-06-01', rtm: [] };
    const hoy = new Date('2026-08-01T15:00:00Z');
    const enDisputa = informeDe({ ...coche, rtmEnDisputa: true }, hoy);
    expect(enDisputa.verificaciones.find((x) => x.id === 'rtm')).toMatchObject({ nivel: 'revision' });
    expect(enDisputa.hallazgos.find((h) => h.verificacion === 'rtm')?.titulo).toContain('No es claro');
    // Sin la marca de la fuente, la regla de los 5 años sigue siendo alerta.
    expect(informeDe(coche, hoy).verificaciones.find((x) => x.id === 'rtm')?.nivel).toBe('alerta');
  });

  it('tres traspasos en dos años requieren revisión', () => {
    const d = datosDe(base);
    d.historial = { estado: 'ok', consultadoEn: null, datos: { propietarios: 4, traspasos: ['2025-01-10', '2025-09-01', '2026-06-15'] } };
    const i = armarInforme(d, { ahora: AHORA, diasVigencia: 7 });
    expect(i.verificaciones.find((x) => x.id === 'propietarios')).toMatchObject({ nivel: 'revision', valor: '3 traspasos en 2 años' });
  });

  it('impuestos sin deuda en cobro no se presenta como paz y salvo', () => {
    const d = datosDe(base);
    d.impuestos = { estado: 'ok', consultadoEn: null, datos: { departamento: 'Bogotá D.C.', totalPendiente: 0, aniosPendientes: [], deudaSinMonto: false } };
    const i = armarInforme(d, { ahora: AHORA, diasVigencia: 7 });
    expect(i.verificaciones.find((x) => x.id === 'impuestos')?.valor).toBe('Sin deuda en cobro · no equivale a paz y salvo');
    expect(i.proximosPasos.join(' ')).toContain('no equivale a estar a paz y salvo');
  });
});
