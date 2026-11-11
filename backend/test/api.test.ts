import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AlmacenamientoLocal } from '../src/almacenamiento/local.js';
import { crearApp } from '../src/api/app.js';
import { RepositorioMemoria } from '../src/consultas/repositorio.js';
import { ServicioConsultas } from '../src/consultas/servicio.js';
import { CuentasMemoria } from '../src/cuentas/repositorio.js';
import { sesionDesarrollo } from '../src/cuentas/sesion.js';
import { ServicioPagos } from '../src/pagos/servicio.js';
import { FuenteSimulada } from '../src/placapi/simulado.js';
import { crearHasher } from '../src/privacidad/hash.js';

const PDF_FALSO = Buffer.from('%PDF-1.7 falso');
const SECRETO_EVENTOS = 'secreto-eventos';

let reloj: Date;
let servicio: ServicioConsultas;
let cuentas: CuentasMemoria;
let repo: RepositorioMemoria;
let dir: string;
let humano: boolean;
let usuario: string;
let token: string;

function app(rutasDesarrollo = true) {
  return crearApp({
    servicio, cuentas, verificarSesion: sesionDesarrollo,
    pagos: new ServicioPagos(cuentas, { publicKey: 'pub_test_x', secretoIntegridad: 'integ', secretoEventos: SECRETO_EVENTOS }),
    verificarHumano: async () => humano, origenes: ['http://localhost:5173'], sinLimites: true, rutasDesarrollo
  });
}

const full = (extra: Record<string, unknown> = {}) => ({
  tipo: 'full', placa: 'abc-12d', docType: 'CC', docNumber: '1.000.000.001',
  consentimiento: { aceptado: true, version: '2026-10' }, ...extra
});

const conToken = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Da saldo al usuario comprando y aprobando por la ruta de desarrollo. */
async function comprar(a: ReturnType<typeof app>, tipo = 'full', cantidad = 2, t = token) {
  const c = await request(a).post('/api/compras').set(conToken(t)).send({ tipo, cantidad });
  await request(a).post(`/api/dev/compras/${c.body.compra.id}/aprobar`).set(conToken(t));
  return c.body;
}

const saldos = async (a: ReturnType<typeof app>) => (await request(a).get('/api/saldo').set(conToken(token))).body.saldos;

beforeEach(async () => {
  reloj = new Date('2026-10-08T15:00:00Z');
  humano = true;
  usuario = randomUUID();
  token = `dev-${usuario}`;
  dir = await mkdtemp(join(tmpdir(), 'csr-pdf-'));
  cuentas = new CuentasMemoria();
  repo = new RepositorioMemoria();
  servicio = new ServicioConsultas({
    repo, cuentas,
    fuente: new FuenteSimulada(0),
    pdf: { renderizar: async () => PDF_FALSO },
    almacenamiento: new AlmacenamientoLocal(dir),
    hash: crearHasher('secreto-de-pruebas-123'),
    diasVigencia: 7,
    ahora: () => reloj
  });
});

describe('sesión y saldo', () => {
  it('sin sesión no se puede consultar', async () => {
    expect((await request(app()).post('/api/consultas').send(full())).status).toBe(401);
    expect((await request(app()).get('/api/saldo').set(conToken('malo'))).status).toBe(401);
  });

  it('sin saldo no se puede consultar', async () => {
    const r = await request(app()).post('/api/consultas').set(conToken(token)).send(full());
    expect(r.status).toBe(402);
    expect(r.body.error).toMatchObject({ codigo: 'sin_saldo', tipo: 'full' });
  });

  it('el saldo de un tipo no sirve para otro', async () => {
    const a = app();
    await comprar(a, 'basico', 1);
    expect((await request(a).post('/api/consultas').set(conToken(token)).send(full())).status).toBe(402);
  });
});

describe('consultas', () => {
  it('descuenta el saldo, genera el PDF y lo deja disponible', async () => {
    const a = app();
    await comprar(a, 'full', 2);
    const r = await request(a).post('/api/consultas').set(conToken(token)).send(full());
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ placa: 'ABC12D', tipo: 'full', estado: 'en_curso' });
    expect((await saldos(a)).full).toBe(1);

    await servicio.esperarProcesos();
    const estado = await request(a).get(`/api/consultas/${r.body.id}`).set(conToken(token));
    expect(estado.body.estado).toBe('completada');
    expect(estado.body.resultado.conclusion.nivel).toBe('atencion_prioritaria');

    const vista = await request(a).get(estado.body.resultado.pdf.vistaPrevia).set(conToken(token));
    expect(vista.status).toBe(200);
    expect(vista.headers['content-type']).toBe('application/pdf');
    expect(vista.headers['content-disposition']).toBe('inline; filename="informe-ABC12D.pdf"');
    const descarga = await request(a).get(estado.body.resultado.pdf.descarga).set(conToken(token));
    expect(descarga.headers['content-disposition']).toBe('attachment; filename="informe-ABC12D.pdf"');
  });

  it('otro usuario no puede ver la consulta ni el PDF', async () => {
    const a = app();
    await comprar(a);
    const r = await request(a).post('/api/consultas').set(conToken(token)).send(full());
    await servicio.esperarProcesos();
    const otro = conToken(`dev-${randomUUID()}`);
    expect((await request(a).get(`/api/consultas/${r.body.id}`).set(otro)).status).toBe(404);
    expect((await request(a).get(`/api/consultas/${r.body.id}/pdf`).set(otro)).status).toBe(404);
  });

  it('los tres tipos piden sus propios datos', async () => {
    const a = app();
    await comprar(a, 'basico', 1);
    await comprar(a, 'vin', 1);
    const comun = { consentimiento: { aceptado: true, version: '2026-10' } };
    expect((await request(a).post('/api/consultas').set(conToken(token)).send({ tipo: 'basico', placa: 'ABC123', ...comun })).status).toBe(202);
    const v = await request(a).post('/api/consultas').set(conToken(token)).send({ tipo: 'vin', vin: '9fla37cz0ea000001', ...comun });
    expect(v.status).toBe(202);
    expect(v.body.placa).toBeNull();
    await servicio.esperarProcesos();
    expect((await request(a).get(`/api/consultas/${v.body.id}`).set(conToken(token))).body.placa).toBe('ABC12D');
    expect((await request(a).post('/api/consultas').set(conToken(token)).send({ tipo: 'vin', vin: 'CORTO', ...comun })).status).toBe(400);
    expect((await request(a).post('/api/consultas').set(conToken(token)).send({ tipo: 'full', placa: 'ABC123', ...comun })).status).toBe(400);
  });

  it('nunca expone el documento, los hashes ni la IP', async () => {
    const a = app();
    await comprar(a);
    const r = await request(a).post('/api/consultas').set(conToken(token)).send(full());
    await servicio.esperarProcesos();
    const estado = await request(a).get(`/api/consultas/${r.body.id}`).set(conToken(token));
    const lista = await request(a).get('/api/consultas').set(conToken(token));
    const texto = JSON.stringify([r.body, estado.body, lista.body]);
    expect(texto).not.toContain('1000000001');
    expect(texto).not.toMatch(/docHash|ipHash|huella|consentimiento/);
  });

  it('exige aceptar el aviso de privacidad', async () => {
    const r = await request(app()).post('/api/consultas').set(conToken(token)).send(full({ consentimiento: { aceptado: false, version: '2026-10' } }));
    expect(r.status).toBe(400);
    expect(r.body.error.campos[0].campo).toBe('consentimiento.aceptado');
  });

  it('rechaza si Turnstile no verifica a la persona', async () => {
    humano = false;
    const r = await request(app()).post('/api/consultas').set(conToken(token)).send(full());
    expect(r.status).toBe(403);
  });

  it('reutiliza la misma consulta: no se paga dos veces', async () => {
    const a = app();
    await comprar(a, 'full', 2);
    const r1 = await request(a).post('/api/consultas').set(conToken(token)).send(full());
    const r2 = await request(a).post('/api/consultas').set(conToken(token)).send(full());
    expect(r2.status).toBe(200);
    expect(r2.body.id).toBe(r1.body.id);
    expect((await saldos(a)).full).toBe(1);
  });

  it('un informe parcial se entrega y consume saldo', async () => {
    const a = app();
    await comprar(a, 'full', 1);
    const r = await request(a).post('/api/consultas').set(conToken(token)).send(full({ placa: 'FAL123' }));
    await servicio.esperarProcesos();
    const e = await request(a).get(`/api/consultas/${r.body.id}`).set(conToken(token));
    expect(e.body.estado).toBe('completada');
    expect(e.body.resultado.parcial).toBe(true);
    expect((await saldos(a)).full).toBe(0);
  });
});

describe('si la consulta falla, no se cobra', () => {
  it.each([
    ['0000000409', 'documento_no_coincide'],
    ['0000000404', 'sin_resultados'],
    ['0000000502', 'fuente_caida']
  ])('documento %s → %s y devuelve el saldo', async (doc, codigo) => {
    const a = app();
    await comprar(a, 'full', 1);
    const r = await request(a).post('/api/consultas').set(conToken(token)).send(full({ docNumber: doc }));
    await servicio.esperarProcesos();
    const estado = await request(a).get(`/api/consultas/${r.body.id}`).set(conToken(token));
    expect(estado.body).toMatchObject({ estado: 'error', error: { codigo, reintentable: true, saldoDevuelto: true } });
    expect((await saldos(a)).full).toBe(1);
    expect((await request(a).get(`/api/consultas/${r.body.id}/pdf`).set(conToken(token))).status).toBe(409);
  });

  it('si falla el PDF también devuelve el saldo', async () => {
    const a = app();
    await comprar(a, 'full', 1);
    const s = new ServicioConsultas({
      repo, cuentas, fuente: new FuenteSimulada(0),
      pdf: { renderizar: async () => { throw new Error('chromium'); } },
      almacenamiento: new AlmacenamientoLocal(dir), hash: crearHasher('secreto-de-pruebas-123'), diasVigencia: 7
    });
    await s.crear({ usuarioId: usuario, entrada: { tipo: 'full', placa: 'ABC123', docType: 'CC', docNumber: '123456' }, consentimiento: { version: 'v' }, ip: '1.1.1.1' });
    await s.esperarProcesos();
    expect((await saldos(a)).full).toBe(1);
  });

  it('una consulta colgada por un reinicio devuelve el saldo', async () => {
    const a = app();
    await comprar(a, 'full', 1);
    const id = randomUUID();
    await cuentas.consumirSaldo(usuario, 'full', id);
    await repo.crear({
      id, usuarioId: usuario, tipo: 'full', placa: 'ABC123', vin: null, docType: 'CC', docHash: 'h', huella: 'h',
      estado: 'en_curso', creadaEn: reloj.toISOString(), actualizadaEn: reloj.toISOString(),
      consentimiento: { version: 'v', aceptadoEn: reloj.toISOString(), ipHash: 'i' }
    });
    expect(await servicio.recuperarColgadas()).toBe(0); // aún reciente
    reloj = new Date(reloj.getTime() + 20 * 60_000);
    expect(await servicio.recuperarColgadas()).toBe(1);
    expect((await saldos(a)).full).toBe(1);
  });
});

describe('compras con Wompi', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const evento = (reference: string, amount_in_cents: number, status = 'APPROVED', secreto = SECRETO_EVENTOS) => {
    const transaction = { id: 'T-1', status, reference, amount_in_cents, payment_method_type: 'NEQUI' };
    const timestamp = 1_700_000_000;
    return {
      event: 'transaction.updated', data: { transaction }, timestamp,
      signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: sha(`T-1${status}${amount_in_cents}${timestamp}${secreto}`) }
    };
  };

  it('la compra calcula el precio en el servidor y firma el widget', async () => {
    const r = await request(app()).post('/api/compras').set(conToken(token)).send({ tipo: 'full', cantidad: 6, total: 1 });
    expect(r.status).toBe(201);
    expect(r.body.compra).toMatchObject({ precioUnitario: 35_000, total: 210_000, estado: 'pendiente' });
    expect(r.body.widget).toMatchObject({ publicKey: 'pub_test_x', currency: 'COP', amountInCents: 21_000_000 });
    expect(r.body.widget.signatureIntegrity).toBe(sha(`${r.body.widget.reference}21000000COPinteg`));
  });

  it('un evento aprobado acredita el saldo una sola vez', async () => {
    const a = app();
    const c = await request(a).post('/api/compras').set(conToken(token)).send({ tipo: 'vin', cantidad: 6 });
    const e = evento(c.body.widget.reference, 17_400_000);
    expect((await request(a).post('/api/webhooks/wompi').send(e)).status).toBe(200);
    expect((await request(a).post('/api/webhooks/wompi').send(e)).status).toBe(200);
    expect((await saldos(a)).vin).toBe(6);
  });

  it('no acredita si el monto no coincide', async () => {
    const a = app();
    const c = await request(a).post('/api/compras').set(conToken(token)).send({ tipo: 'full', cantidad: 1 });
    expect((await request(a).post('/api/webhooks/wompi').send(evento(c.body.widget.reference, 100))).status).toBe(200);
    expect((await saldos(a)).full).toBe(0);
  });

  it('rechaza un evento con firma inválida', async () => {
    const a = app();
    const c = await request(a).post('/api/compras').set(conToken(token)).send({ tipo: 'full', cantidad: 1 });
    expect((await request(a).post('/api/webhooks/wompi').send(evento(c.body.widget.reference, 4_500_000, 'APPROVED', 'falso'))).status).toBe(401);
    expect((await saldos(a)).full).toBe(0);
  });

  it('un pago rechazado no da saldo', async () => {
    const a = app();
    const c = await request(a).post('/api/compras').set(conToken(token)).send({ tipo: 'full', cantidad: 1 });
    await request(a).post('/api/webhooks/wompi').send(evento(c.body.widget.reference, 4_500_000, 'DECLINED'));
    expect((await saldos(a)).full).toBe(0);
    expect((await request(a).get('/api/compras').set(conToken(token))).body.compras[0].estado).toBe('rechazada');
  });

  it('la ruta de aprobar sin pago no existe fuera de desarrollo', async () => {
    const a = app(false);
    const c = await request(a).post('/api/compras').set(conToken(token)).send({ tipo: 'full', cantidad: 1 });
    expect((await request(a).post(`/api/dev/compras/${c.body.compra.id}/aprobar`).set(conToken(token))).status).toBe(404);
  });
});

describe('precios públicos', () => {
  it('no exige sesión', async () => {
    expect((await request(app()).get('/api/precios')).body.rangos).toHaveLength(4);
    const c = await request(app()).get('/api/precios/cotizar?tipo=full&cantidad=5');
    expect(c.body).toMatchObject({ total: 225_000, mejorOpcion: { cantidad: 6 } });
  });
});

describe('vigencia de 7 días', () => {
  it('después de 7 días el PDF ya no se entrega y la limpieza lo borra', async () => {
    const a = app();
    await comprar(a);
    const r = await request(a).post('/api/consultas').set(conToken(token)).send(full());
    await servicio.esperarProcesos();

    reloj = new Date('2026-10-15T23:00:00-05:00'); // día 7, antes de medianoche
    expect((await request(a).get(`/api/consultas/${r.body.id}/pdf`).set(conToken(token))).status).toBe(200);

    reloj = new Date('2026-10-16T00:30:00-05:00'); // día 8
    expect((await request(a).get(`/api/consultas/${r.body.id}`).set(conToken(token))).body.estado).toBe('vencida');
    expect((await request(a).get(`/api/consultas/${r.body.id}/pdf`).set(conToken(token))).status).toBe(410);

    expect(await servicio.limpiarVencidas()).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });
});
