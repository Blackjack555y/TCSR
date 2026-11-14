import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AlmacenamientoLocal } from '../src/almacenamiento/local.js';
import { crearApp } from '../src/api/app.js';
import { obtenerDatosConCreditos } from '../src/consultas/orquestador.js';
import { RepositorioMemoria } from '../src/consultas/repositorio.js';
import { ServicioConsultas } from '../src/consultas/servicio.js';
import { CuentasMemoria } from '../src/cuentas/repositorio.js';
import { sesionDesarrollo } from '../src/cuentas/sesion.js';
import { EnviadorRegistro, Notificador, type EnviadorCorreo } from '../src/notificaciones/correo.js';
import { ServicioPagos } from '../src/pagos/servicio.js';
import type { ConsultorWompi } from '../src/pagos/wompi-api.js';
import type { TransaccionWompi } from '../src/pagos/wompi.js';
import { FuenteSimulada } from '../src/placapi/simulado.js';
import { crearHasher } from '../src/privacidad/hash.js';

const fuente = new FuenteSimulada(0);

/** Wompi falso: las transacciones que "existen" en Wompi. */
class WompiFalso implements ConsultorWompi {
  readonly transacciones = new Map<string, TransaccionWompi>();
  consultas = 0;
  async obtenerTransaccion(id: string) {
    this.consultas++;
    return this.transacciones.get(id) ?? null;
  }
}

let cuentas: CuentasMemoria;
let repo: RepositorioMemoria;
let correos: EnviadorRegistro;
let wompi: WompiFalso;
let servicio: ServicioConsultas;
let pagos: ServicioPagos;
let usuario: string;
let token: string;

beforeEach(async () => {
  cuentas = new CuentasMemoria();
  repo = new RepositorioMemoria();
  correos = new EnviadorRegistro();
  wompi = new WompiFalso();
  const notificador = new Notificador(correos, async (id) => `${id}@ejemplo.com`, 'https://sitio.test');
  servicio = new ServicioConsultas({
    repo, cuentas, fuente, notificador,
    pdf: { renderizar: async () => Buffer.from('%PDF') },
    almacenamiento: new AlmacenamientoLocal(await mkdtemp(join(tmpdir(), 'csr-op-'))),
    hash: crearHasher('secreto-de-pruebas-123'), diasVigencia: 7, limiteFallidasDia: 5
  });
  pagos = new ServicioPagos(cuentas, { publicKey: 'pub_test_x', secretoIntegridad: 'i', secretoEventos: 'e' }, wompi, notificador);
  usuario = randomUUID();
  token = `dev-${usuario}`;
});

const app = () => crearApp({ servicio, pagos, cuentas, verificarSesion: sesionDesarrollo, verificarHumano: async () => true, origenes: [], sinLimites: true, rutasDesarrollo: true });
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
const consentimiento = { aceptado: true, version: 'v' };

async function darSaldo(a: ReturnType<typeof app>, cantidad: number) {
  const c = await request(a).post('/api/compras').set(auth()).send({ tipo: 'full', cantidad });
  await request(a).post(`/api/dev/compras/${c.body.compra.id}/aprobar`).set(auth());
}

describe('límite de consultas fallidas', () => {
  it('después de 5 fallidas por datos en 24 h bloquea, sin descontar saldo', async () => {
    const a = app();
    await darSaldo(a, 1);
    for (let i = 0; i < 5; i++) {
      const r = await request(a).post('/api/consultas').set(auth()).send({ tipo: 'full', placa: 'ABC123', docType: 'CC', docNumber: i % 2 === 0 ? '0000000409' : '0000000404', consentimiento });
      expect(r.status).toBe(202);
      await servicio.esperarProcesos();
    }
    const bloqueada = await request(a).post('/api/consultas').set(auth()).send({ tipo: 'full', placa: 'ABC123', docType: 'CC', docNumber: '1020304050', consentimiento });
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.body.error.codigo).toBe('demasiados_intentos');
    expect((await cuentas.saldos(usuario)).full).toBe(1);
  });

  it('una fuente caída no cuenta: no es culpa del usuario', async () => {
    const a = app();
    await darSaldo(a, 1);
    for (let i = 0; i < 6; i++) {
      await request(a).post('/api/consultas').set(auth()).send({ tipo: 'full', placa: 'ABC123', docType: 'CC', docNumber: '0000000502', consentimiento });
      await servicio.esperarProcesos();
    }
    const r = await request(a).post('/api/consultas').set(auth()).send({ tipo: 'full', placa: 'ABC999', docType: 'CC', docNumber: '1020304050', consentimiento });
    expect(r.status).toBe(202);
  });
});

describe('verificación y conciliación de pagos con Wompi', () => {
  async function compraPendiente(a: ReturnType<typeof app>) {
    const c = await request(a).post('/api/compras').set(auth()).send({ tipo: 'vin', cantidad: 2 });
    return c.body;
  }

  it('si el webhook no llega, la verificación desde el navegador acredita el saldo', async () => {
    const a = app();
    const { compra, widget } = await compraPendiente(a);
    wompi.transacciones.set('TX-1', { id: 'TX-1', status: 'APPROVED', reference: widget.reference, amount_in_cents: widget.amountInCents, payment_method_type: 'PSE' });

    const r = await request(a).post(`/api/compras/${compra.id}/verificar`).set(auth()).send({ transaccionId: 'TX-1' });
    expect(r.body.compra.estado).toBe('aprobada');
    expect((await cuentas.saldos(usuario)).vin).toBe(2);

    // Repetir no acredita dos veces ni vuelve a consultar a Wompi.
    await request(a).post(`/api/compras/${compra.id}/verificar`).set(auth()).send({ transaccionId: 'TX-1' });
    expect((await cuentas.saldos(usuario)).vin).toBe(2);
    expect(wompi.consultas).toBe(1);
  });

  it('una transacción de otra compra no sirve, ni la de otro usuario', async () => {
    const a = app();
    const { compra } = await compraPendiente(a);
    wompi.transacciones.set('TX-OTRA', { id: 'TX-OTRA', status: 'APPROVED', reference: 'CSR-otra', amount_in_cents: 7_400_000 });
    const r = await request(a).post(`/api/compras/${compra.id}/verificar`).set(auth()).send({ transaccionId: 'TX-OTRA' });
    expect(r.body.compra.estado).toBe('pendiente');
    expect((await cuentas.saldos(usuario)).vin).toBe(0);
    expect((await request(a).post(`/api/compras/${compra.id}/verificar`).set(auth(`dev-${randomUUID()}`)).send({ transaccionId: 'TX-OTRA' })).status).toBe(404);
    expect((await request(a).post(`/api/compras/${compra.id}/verificar`).set(auth()).send({ transaccionId: 'mal id ' })).status).toBe(400);
  });

  it('un monto distinto no acredita', async () => {
    const a = app();
    const { compra, widget } = await compraPendiente(a);
    wompi.transacciones.set('TX-2', { id: 'TX-2', status: 'APPROVED', reference: widget.reference, amount_in_cents: 100 });
    await request(a).post(`/api/compras/${compra.id}/verificar`).set(auth()).send({ transaccionId: 'TX-2' });
    expect((await cuentas.saldos(usuario)).vin).toBe(0);
  });

  it('la conciliación resuelve las compras pendientes con transacción conocida', async () => {
    const a = app();
    const { compra, widget } = await compraPendiente(a);
    // El navegador alcanzó a informar la transacción, pero seguía pendiente en Wompi.
    wompi.transacciones.set('TX-3', { id: 'TX-3', status: 'PENDING', reference: widget.reference, amount_in_cents: widget.amountInCents });
    await request(a).post(`/api/compras/${compra.id}/verificar`).set(auth()).send({ transaccionId: 'TX-3' });
    expect((await cuentas.obtenerCompra(compra.id))?.transaccionId).toBe('TX-3');

    const despues = new Date(Date.now() + 10 * 60_000);
    expect(await pagos.conciliarPendientes(despues)).toBe(0); // sigue pendiente
    wompi.transacciones.set('TX-3', { ...wompi.transacciones.get('TX-3')!, status: 'APPROVED' });
    expect(await pagos.conciliarPendientes(despues)).toBe(1);
    expect((await cuentas.saldos(usuario)).vin).toBe(2);
  });

  it('un pago rechazado en Wompi deja la compra rechazada', async () => {
    const a = app();
    const { compra, widget } = await compraPendiente(a);
    wompi.transacciones.set('TX-4', { id: 'TX-4', status: 'DECLINED', reference: widget.reference, amount_in_cents: widget.amountInCents });
    const r = await request(a).post(`/api/compras/${compra.id}/verificar`).set(auth()).send({ transaccionId: 'TX-4' });
    expect(r.body.compra.estado).toBe('rechazada');
  });
});

describe('correos', () => {
  it('avisa la compra aprobada y el informe listo, una vez cada uno', async () => {
    const a = app();
    const { compra, widget } = (await request(a).post('/api/compras').set(auth()).send({ tipo: 'full', cantidad: 1 })).body;
    wompi.transacciones.set('TX-5', { id: 'TX-5', status: 'APPROVED', reference: widget.reference, amount_in_cents: widget.amountInCents });
    await request(a).post(`/api/compras/${compra.id}/verificar`).set(auth()).send({ transaccionId: 'TX-5' });
    const c = await request(a).post('/api/consultas').set(auth()).send({ tipo: 'full', placa: 'ABC123', docType: 'CC', docNumber: '1020304050', consentimiento });
    await servicio.esperarProcesos();
    await new Promise((r) => setTimeout(r, 20));

    expect(correos.enviados.map((e) => e.idempotencia)).toEqual([`compra-${compra.id}`, `informe-${c.body.id}`]);
    expect(correos.enviados[0]!.para).toBe(`${usuario}@ejemplo.com`);
    expect(correos.enviados[1]!.html).toContain(`https://sitio.test/informe.html?id=${c.body.id}`);
    expect(correos.enviados.map((e) => e.html).join()).not.toContain('1020304050');
  });

  it('un correo que falla no frena la consulta', async () => {
    const falla: EnviadorCorreo = { enviar: async () => { throw new Error('caído'); } };
    const s = new ServicioConsultas({
      repo, cuentas, fuente, notificador: new Notificador(falla, async () => 'x@ejemplo.com', 'https://sitio.test'),
      pdf: { renderizar: async () => Buffer.from('%PDF') },
      almacenamiento: new AlmacenamientoLocal(await mkdtemp(join(tmpdir(), 'csr-op-'))),
      hash: crearHasher('secreto-de-pruebas-123'), diasVigencia: 7
    });
    await cuentas.crearCompra({ id: 'c1', usuarioId: usuario, tipo: 'basico', cantidad: 1, precioUnitario: 22_500, total: 22_500, referencia: 'R1', estado: 'pendiente', creadaEn: new Date().toISOString() });
    await cuentas.aprobarCompra('R1', 'T', 2_250_000, null);
    const { consulta } = await s.crear({ usuarioId: usuario, entrada: { tipo: 'basico', placa: 'ABC123' }, consentimiento: { version: 'v' }, ip: '1' });
    await s.esperarProcesos();
    expect((await repo.obtener(consulta.id))?.estado).toBe('completada');
  });
});

describe('créditos de PlacApi gastados', () => {
  it.each([
    [{ tipo: 'full', placa: 'ABC123', docType: 'CC', docNumber: '1020304050' }, 7],
    [{ tipo: 'vin', vin: '9FLA37CZ0EA000001' }, 6],
    [{ tipo: 'basico', placa: 'ABC123' }, 5],
    [{ tipo: 'full', placa: 'FAL123', docType: 'CC', docNumber: '1020304050' }, 6] // hurto falló: no cobra
  ] as const)('%o → %i créditos', async (entrada, esperado) => {
    expect((await obtenerDatosConCreditos(fuente, entrada)).creditos).toBe(esperado);
  });

  it('si el documento no coincide no se llama a nada más: 0 créditos', async () => {
    await expect(obtenerDatosConCreditos(fuente, { tipo: 'full', placa: 'ABC123', docType: 'CC', docNumber: '0000000409' }))
      .rejects.toMatchObject({ creditos: 0 });
  });

  it('queda guardado en la consulta', async () => {
    const a = app();
    await darSaldo(a, 1);
    const r = await request(a).post('/api/consultas').set(auth()).send({ tipo: 'full', placa: 'ABC123', docType: 'CC', docNumber: '1020304050', consentimiento });
    await servicio.esperarProcesos();
    expect((await repo.obtener(r.body.id))?.creditosEstimados).toBe(7);
  });
});
