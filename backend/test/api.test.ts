import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AlmacenamientoLocal } from '../src/almacenamiento/local.js';
import { crearApp } from '../src/api/app.js';
import { RepositorioMemoria } from '../src/consultas/repositorio.js';
import { ServicioConsultas } from '../src/consultas/servicio.js';
import { FuenteSimulada } from '../src/placapi/simulado.js';
import { crearHasher } from '../src/privacidad/hash.js';

const PDF_FALSO = Buffer.from('%PDF-1.7 falso');

let reloj: Date;
let servicio: ServicioConsultas;
let dir: string;
let humano: boolean;

function app() {
  return crearApp({ servicio, verificarHumano: async () => humano, origenes: ['http://localhost:5173'], sinLimites: true });
}

const cuerpo = (extra: Record<string, unknown> = {}) => ({
  placa: 'abc-12d',
  docType: 'CC',
  docNumber: '1.000.000.001',
  consentimiento: { aceptado: true, version: '2026-10' },
  ...extra
});

beforeEach(async () => {
  reloj = new Date('2026-10-08T15:00:00Z');
  humano = true;
  dir = await mkdtemp(join(tmpdir(), 'csr-pdf-'));
  servicio = new ServicioConsultas({
    repo: new RepositorioMemoria(),
    fuente: new FuenteSimulada(0),
    pdf: { renderizar: async () => PDF_FALSO },
    almacenamiento: new AlmacenamientoLocal(dir),
    hash: crearHasher('secreto-de-pruebas-123'),
    diasVigencia: 7,
    ahora: () => reloj
  });
});

describe('POST /api/consultas', () => {
  it('crea la consulta, genera el PDF y lo deja disponible', async () => {
    const a = app();
    const r = await request(a).post('/api/consultas').send(cuerpo());
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ placa: 'ABC12D', estado: 'en_curso' });
    expect(r.headers.location).toBe(`/api/consultas/${r.body.id}`);

    await servicio.esperarProcesos();
    const estado = await request(a).get(`/api/consultas/${r.body.id}`);
    expect(estado.body.estado).toBe('completada');
    expect(estado.body.resultado.conclusion).toMatchObject({ nivel: 'revision_recomendada', aspectosAtencion: 2 });
    expect(estado.body.resultado.pdf.vistaPrevia).toBe(`/api/consultas/${r.body.id}/pdf`);

    const vista = await request(a).get(estado.body.resultado.pdf.vistaPrevia);
    expect(vista.status).toBe(200);
    expect(vista.headers['content-type']).toBe('application/pdf');
    expect(vista.headers['content-disposition']).toBe('inline; filename="informe-ABC12D.pdf"');

    const descarga = await request(a).get(estado.body.resultado.pdf.descarga);
    expect(descarga.headers['content-disposition']).toBe('attachment; filename="informe-ABC12D.pdf"');
  });

  it('nunca expone el documento, su hash ni la IP', async () => {
    const a = app();
    const r = await request(a).post('/api/consultas').send(cuerpo());
    await servicio.esperarProcesos();
    const estado = await request(a).get(`/api/consultas/${r.body.id}`);
    const texto = JSON.stringify([r.body, estado.body]);
    expect(texto).not.toContain('1000000001');
    expect(texto).not.toMatch(/docHash|ipHash|consentimiento/);
  });

  it('exige aceptar el aviso de privacidad', async () => {
    const r = await request(app()).post('/api/consultas').send(cuerpo({ consentimiento: { aceptado: false, version: '2026-10' } }));
    expect(r.status).toBe(400);
    expect(r.body.error.campos[0].campo).toBe('consentimiento.aceptado');
  });

  it('rechaza placa o documento inválidos', async () => {
    const r = await request(app()).post('/api/consultas').send(cuerpo({ placa: 'AB1', docNumber: '12' }));
    expect(r.status).toBe(400);
    expect(r.body.error.campos.map((c: { campo: string }) => c.campo).sort()).toEqual(['docNumber', 'placa']);
  });

  it('rechaza si Turnstile no verifica a la persona', async () => {
    humano = false;
    const r = await request(app()).post('/api/consultas').send(cuerpo());
    expect(r.status).toBe(403);
  });

  it('reutiliza la consulta de la misma placa y documento: no se paga dos veces', async () => {
    const a = app();
    const r1 = await request(a).post('/api/consultas').send(cuerpo());
    const r2 = await request(a).post('/api/consultas').send(cuerpo());
    expect(r2.status).toBe(200);
    expect(r2.body.id).toBe(r1.body.id);
  });
});

describe('estados del sistema', () => {
  it.each([
    ['0000000409', 'documento_no_coincide'],
    ['0000000404', 'sin_resultados'],
    ['0000000502', 'fuente_caida']
  ])('documento %s → %s', async (doc, codigo) => {
    const a = app();
    const r = await request(a).post('/api/consultas').send(cuerpo({ docNumber: doc }));
    await servicio.esperarProcesos();
    const estado = await request(a).get(`/api/consultas/${r.body.id}`);
    expect(estado.body).toMatchObject({ estado: 'error', error: { codigo, reintentable: true } });
    expect(estado.body.error.mensaje).toBeTruthy();

    const pdf = await request(a).get(`/api/consultas/${r.body.id}/pdf`);
    expect(pdf.status).toBe(409);
  });

  it('una consulta que no existe da 404', async () => {
    expect((await request(app()).get('/api/consultas/no-es-un-uuid')).status).toBe(404);
    expect((await request(app()).get('/api/consultas/7b0e8f3c-0d3f-4a8e-9a43-2f0b5d1e9c11/pdf')).status).toBe(404);
  });
});

describe('vigencia de 7 días', () => {
  it('después de 7 días el PDF ya no se entrega y la limpieza lo borra', async () => {
    const a = app();
    const r = await request(a).post('/api/consultas').send(cuerpo());
    await servicio.esperarProcesos();

    reloj = new Date('2026-10-15T23:00:00-05:00'); // día 7, antes de medianoche
    expect((await request(a).get(`/api/consultas/${r.body.id}/pdf`)).status).toBe(200);

    reloj = new Date('2026-10-16T00:30:00-05:00'); // día 8
    expect((await request(a).get(`/api/consultas/${r.body.id}`)).body.estado).toBe('vencida');
    expect((await request(a).get(`/api/consultas/${r.body.id}/pdf`)).status).toBe(410);

    expect(await servicio.limpiarVencidas()).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });
});
