import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { VehiculoRunt } from '../src/dominio/tipos.js';
import { armarInforme, concluir } from '../src/informe/armar.js';
import { normalizarRunt } from '../src/normalizacion/runt.js';
import { fecha, siNo, texto } from '../src/normalizacion/valores.js';
import { analizarVigencias } from '../src/reglas/vigencias.js';
import type { RawConsultaRunt } from '../src/placapi/tipos.js';

const raw = JSON.parse(readFileSync(new URL('../fixtures/runt-consulta-abc12d.json', import.meta.url), 'utf8')) as RawConsultaRunt;
// 8 de octubre de 2026, 10:00 en Colombia: el día de la consulta real.
const AHORA = new Date('2026-10-08T15:00:00Z');

const informeDe = (v: VehiculoRunt, ahora = AHORA) =>
  armarInforme(v, { ahora, consultadoEn: '2026-10-08T13:00:55.106Z', diasVigencia: 7 });

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
    for (const id of ['multas', 'impuestos', 'hurto', 'siniestros', 'propietarios', 'antecedentes_propietario']) {
      expect(ver(id)).toMatchObject({ nivel: 'no_disponible', consulta: 'no_consultada' });
    }
  });

  it('concluye "Revisión recomendada" con 2 aspectos', () => {
    expect(informe.conclusion).toMatchObject({ nivel: 'revision_recomendada', aspectosAtencion: 2, noDisponibles: 6 });
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
});
