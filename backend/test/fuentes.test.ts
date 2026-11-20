import { describe, expect, it } from 'vitest';
import { obtenerDatos } from '../src/consultas/orquestador.js';
import { armarInforme } from '../src/informe/armar.js';
import { acreedorSeguro, normalizarFull } from '../src/normalizacion/fuentes.js';
import { ErrorFuente, type FuenteVehicular, type ParametrosFull } from '../src/placapi/index.js';
import { FuenteSimulada } from '../src/placapi/simulado.js';

const AHORA = new Date('2026-07-30T15:00:00Z');
const fuente = new FuenteSimulada(0);
const informe = async (e: Parameters<typeof obtenerDatos>[1], f: FuenteVehicular = fuente) =>
  armarInforme(await obtenerDatos(f, e), { ahora: AHORA, diasVigencia: 7 });
const FULL = { tipo: 'full', placa: 'ABC123', docType: 'CC', docNumber: '1020304050' } as const;

describe('informe Full', () => {
  it('reúne todas las fuentes', async () => {
    const i = await informe(FULL);
    const ver = (id: string) => i.verificaciones.find((v) => v.id === id);
    expect(i.tipo).toBe('full');
    expect(i.parcial).toBe(false);
    expect(ver('prendas')).toMatchObject({ nivel: 'alerta', valor: '1 prenda' });
    expect(ver('impuestos')).toMatchObject({ nivel: 'revision', valor: 'Pendiente: $ 465.000' });
    expect(ver('multas')).toMatchObject({ nivel: 'sin_hallazgos' });
    expect(ver('avaluo')?.valor).toBe('$ 109.100.000');
    expect(ver('hurto')).toMatchObject({ nivel: 'sin_hallazgos' });
    // La fuente no trae el historial completo: gris, con el último traspaso que sí conoce.
    expect(ver('propietarios')).toMatchObject({ nivel: 'no_disponible', consulta: 'no_cubierta' });
    expect(ver('propietarios')?.valor).toContain('Historial incompleto');
    expect(i.proximosPasos.join(' ')).toContain('certificado de tradición');
    expect(ver('antecedentes_propietario')).toMatchObject({ nivel: 'no_disponible' });
    expect(i.conclusion.nivel).toBe('atencion_prioritaria');
    expect(JSON.stringify(i)).not.toContain('1020304050');
  });

  it('muestra el acreedor empresa, pero no a una persona natural', () => {
    expect(acreedorSeguro('RCI COLOMBIA S.A. COMPAÑIA DE FINANCIAMIENTO')).toContain('RCI');
    expect(acreedorSeguro('BANCOLOMBIA')).toBe('BANCOLOMBIA');
    expect(acreedorSeguro('JUAN PEREZ GOMEZ')).toBe('Persona natural (dato protegido)');
    expect(acreedorSeguro('JUAN PEREZ', 'CC')).toBe('Persona natural (dato protegido)');
  });

  it('alertas de hurto y pérdida total', async () => {
    const i = await informe({ ...FULL, placa: 'ALE123' });
    expect(i.verificaciones.find((v) => v.id === 'hurto')?.nivel).toBe('alerta');
    expect(i.verificaciones.find((v) => v.id === 'siniestros')?.valor).toBe('Registra pérdida total');
    expect(JSON.stringify(i)).not.toContain('760016000193202612345'); // noticia criminal
  });

  it('si el documento no coincide no gasta más créditos', async () => {
    let llamadas = 0;
    const f = new Proxy(fuente, {
      get(t, k: keyof FuenteVehicular) {
        if (k === 'reporteHurto' || k === 'perdidaTotal') llamadas++;
        return (t[k] as (...a: unknown[]) => unknown).bind(t);
      }
    }) as FuenteVehicular;
    await expect(informe({ ...FULL, docNumber: '0000000409' }, f)).rejects.toMatchObject({ codigo: 'documento_no_coincide' });
    expect(llamadas).toBe(0);
  });

  it('una fuente caída nunca se muestra como "sin hallazgos"', async () => {
    const i = await informe({ ...FULL, placa: 'FAL123' });
    expect(i.verificaciones.find((v) => v.id === 'hurto')).toMatchObject({ nivel: 'no_disponible', consulta: 'error' });
    expect(i.parcial).toBe(true);
  });

  it('un bloque fallido de SOAT no se interpreta como "no tiene SOAT"', async () => {
    const f = new class extends FuenteSimulada {
      override async consultaFull(p: ParametrosFull) {
        const raw = await super.consultaFull(p);
        raw.soat = { status: 'error', data: null };
        raw.antecedentes = { status: 'error', data: null };
        return raw;
      }
    }(0);
    const i = await informe(FULL, f);
    expect(i.verificaciones.find((v) => v.id === 'soat')).toMatchObject({ nivel: 'no_disponible', consulta: 'error' });
    expect(i.verificaciones.find((v) => v.id === 'gravamenes')).toMatchObject({ nivel: 'no_disponible' });
    expect(i.verificaciones.find((v) => v.id === 'prendas')).toMatchObject({ nivel: 'no_disponible' });
    expect(i.hallazgos.some((h) => /SOAT/.test(h.titulo))).toBe(false);
  });

  it('si no hay ficha del vehículo no se entrega informe', async () => {
    const f = new class extends FuenteSimulada {
      override async consultaFull() {
        return { vehicle: { status: 'error', data: null } };
      }
    }(0);
    await expect(obtenerDatos(f, FULL)).rejects.toBeInstanceOf(ErrorFuente);
  });

  it('impuesto no publicado por el departamento: no disponible', async () => {
    const raw = await fuente.consultaFull(FULL);
    raw.impuestos = { status: 'empty', data: null };
    expect(normalizarFull(raw).impuestos.estado).toBe('no_cubierta');
  });
});

describe('informe Por VIN', () => {
  it('usa la placa que devuelve la fuente y no trae SIMIT ni impuestos', async () => {
    const i = await informe({ tipo: 'vin', vin: '9FLA37CZ0EA000001' });
    const ver = (id: string) => i.verificaciones.find((v) => v.id === id);
    expect(i.vehiculo.placa).toBe('ABC12D');
    expect(ver('soat')?.consulta).toBe('ok');
    expect(ver('hurto')?.consulta).toBe('ok');
    expect(ver('avaluo')?.consulta).toBe('ok');
    expect(ver('multas')).toMatchObject({ nivel: 'no_disponible', consulta: 'no_consultada' });
    expect(ver('impuestos')).toMatchObject({ nivel: 'no_disponible', consulta: 'no_consultada' });
  });
});

describe('informe Básico', () => {
  it('trae hurto, reclamaciones y prendas; lo demás es no disponible', async () => {
    const i = await informe({ tipo: 'basico', placa: 'ALE123' });
    const ver = (id: string) => i.verificaciones.find((v) => v.id === id);
    expect(ver('hurto')?.consulta).toBe('ok');
    expect(ver('siniestros')?.consulta).toBe('ok');
    expect(ver('prendas')).toMatchObject({ nivel: 'alerta', consulta: 'ok' });
    expect(ver('soat')).toMatchObject({ nivel: 'no_disponible', consulta: 'no_consultada' });
    expect(i.metodologia.at(-1)).toContain('no identifica el vehículo');
    expect(JSON.stringify(i)).not.toContain('73140250'); // documento del deudor
    expect(JSON.stringify(i)).not.toContain('JUAN PEREZ');
  });

  it('nunca concluye "sin alertas": siniestros sin reclamaciones no descarta salvamento', async () => {
    const i = await informe({ tipo: 'basico', placa: 'ABC123' });
    const s = i.verificaciones.find((v) => v.id === 'siniestros');
    expect(s).toMatchObject({ nivel: 'revision', valor: 'Sin reclamaciones reportadas · no descarta salvamento' });
    expect(i.hallazgos.find((h) => h.verificacion === 'siniestros')?.queHacer).toContain('certificado de tradición');
    expect(i.conclusion.nivel).toBe('revision_recomendada');
  });
});

describe('accidentes en Bogotá', () => {
  it('sin registros: sin hallazgos, aclarando que solo cubre Bogotá', async () => {
    const i = await informe({ tipo: 'basico', placa: 'ABC123' });
    expect(i.verificaciones.find((v) => v.id === 'accidentes')).toMatchObject({ nivel: 'sin_hallazgos', valor: 'Sin accidentes registrados en Bogotá' });
  });

  it('con un accidente con heridos: requiere revisión y queda en la evidencia', async () => {
    const i = await informe({ tipo: 'basico', placa: 'ALE123' });
    expect(i.verificaciones.find((v) => v.id === 'accidentes')).toMatchObject({ nivel: 'revision', valor: '1 accidente en Bogotá (el más grave: con heridos)' });
    expect(i.hallazgos.find((h) => h.verificacion === 'accidentes')?.queEncontramos).toContain('20/05/2023');
    expect(i.evidencia.accidentes).toEqual([{ fecha: '2023-05-20', gravedad: 'CON HERIDOS' }]);
  });

  it('si la fuente falla, queda no disponible y el informe es parcial', async () => {
    const f: FuenteVehicular = { ...fuente, consultaFull: fuente.consultaFull.bind(fuente), reporteHurto: fuente.reporteHurto.bind(fuente),
      perdidaTotal: fuente.perdidaTotal.bind(fuente), garantiasRgm: fuente.garantiasRgm.bind(fuente), consultaPorVin: fuente.consultaPorVin.bind(fuente),
      avaluoPorVin: fuente.avaluoPorVin.bind(fuente), accidentesBogota: async () => { throw new ErrorFuente('fuente_caida', 502, 'source_error'); } };
    const i = await informe(FULL, f);
    expect(i.verificaciones.find((v) => v.id === 'accidentes')).toMatchObject({ nivel: 'no_disponible', consulta: 'error' });
    expect(i.parcial).toBe(true);
  });
});
