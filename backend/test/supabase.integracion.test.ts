// Prueba contra un Supabase de verdad (local). Se omite si no hay uno configurado:
//   npx supabase start && SUPABASE_PRUEBAS_URL=... SUPABASE_PRUEBAS_LLAVE=... SUPABASE_PRUEBAS_ANON=... npm test
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { crearApp } from '../src/api/app.js';
import { ServicioConsultas } from '../src/consultas/servicio.js';
import { sesionSupabase } from '../src/cuentas/sesion.js';
import { ServicioPagos } from '../src/pagos/servicio.js';
import { FuenteSimulada } from '../src/placapi/simulado.js';
import { crearHasher } from '../src/privacidad/hash.js';
import { AlmacenamientoSupabase } from '../src/supabase/almacenamiento.js';
import { crearClienteServidor } from '../src/supabase/cliente.js';
import { ConsultasSupabase } from '../src/supabase/consultas.js';
import { CuentasSupabase } from '../src/supabase/cuentas.js';

const URL_DB = process.env.SUPABASE_PRUEBAS_URL;
const LLAVE = process.env.SUPABASE_PRUEBAS_LLAVE;
const ANON = process.env.SUPABASE_PRUEBAS_ANON;

describe.skipIf(!URL_DB || !LLAVE || !ANON)('integración con Supabase', () => {
  const db = crearClienteServidor(URL_DB!, LLAVE!);
  const cuentas = new CuentasSupabase(db);
  const repo = new ConsultasSupabase(db);
  const almacenamiento = new AlmacenamientoSupabase(db);
  const PDF = Buffer.from('%PDF-1.7 prueba integración');
  let reloj: Date | null = null;
  const servicio = new ServicioConsultas({
    repo, cuentas, fuente: new FuenteSimulada(0), almacenamiento,
    pdf: { renderizar: async () => PDF },
    hash: crearHasher('secreto-de-pruebas-123'), diasVigencia: 7, ahora: () => reloj ?? new Date()
  });
  const pagos = new ServicioPagos(cuentas, { publicKey: 'pub_test_x', secretoIntegridad: 'i', secretoEventos: 'e' });
  const app = crearApp({
    servicio, pagos, cuentas, verificarSesion: sesionSupabase(db), verificarHumano: async () => true,
    origenes: ['http://localhost:5173'], sinLimites: true, rutasDesarrollo: true
  });

  async function crearUsuario() {
    const correo = `prueba-${randomUUID()}@ejemplo.com`;
    const clave = 'clave-de-prueba-123';
    const { data, error } = await db.auth.admin.createUser({ email: correo, password: clave, email_confirm: true, user_metadata: { nombre: 'Prueba' } });
    expect(error).toBeNull();
    const cliente = createClient(URL_DB!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const s = await cliente.auth.signInWithPassword({ email: correo, password: clave });
    expect(s.error).toBeNull();
    return { id: data.user!.id, token: s.data.session!.access_token, cliente };
  }
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let a: Awaited<ReturnType<typeof crearUsuario>>;
  let b: Awaited<ReturnType<typeof crearUsuario>>;

  beforeAll(async () => {
    a = await crearUsuario();
    b = await crearUsuario();
  });

  it('el registro crea el perfil y cada usuario solo ve el suyo', async () => {
    const propio = await a.cliente.from('perfiles').select('id, nombre');
    expect(propio.data).toEqual([{ id: a.id, nombre: 'Prueba' }]);
    const ajeno = await a.cliente.from('perfiles').select('id').eq('id', b.id);
    expect(ajeno.data).toEqual([]);
  });

  it('un usuario no puede leer ni tocar saldo, compras o consultas directamente', async () => {
    await cuentas.crearCompra({ id: randomUUID(), usuarioId: a.id, tipo: 'basico', cantidad: 1, precioUnitario: 22_500, total: 22_500, referencia: `REF-${randomUUID()}`, estado: 'pendiente', creadaEn: new Date().toISOString() });
    for (const t of ['compras', 'saldos', 'movimientos_saldo', 'consultas', 'consentimientos']) {
      expect((await a.cliente.from(t).select('*')).data, t).toEqual([]);
    }
    const insertar = await a.cliente.from('saldos').insert({ usuario_id: a.id, tipo: 'full', disponibles: 999 });
    expect(insertar.error).not.toBeNull();
    const rpc = await a.cliente.rpc('aprobar_compra', { p_referencia: 'x', p_transaccion_id: 'x', p_monto_centavos: 1, p_medio_pago: 'x' });
    expect(rpc.error).not.toBeNull();
    const pdf = await a.cliente.storage.from('informes').list();
    expect(pdf.data ?? []).toEqual([]);
  });

  it('flujo completo: compra, webhook idempotente, consulta y PDF en el bucket', async () => {
    const c = await request(app).post('/api/compras').set(auth(a.token)).send({ tipo: 'full', cantidad: 2 });
    expect(c.status).toBe(201);
    const ref = c.body.widget.reference;

    expect(await cuentas.aprobarCompra(ref, 'T-1', 1, 'NEQUI')).toBe('monto_no_coincide');
    expect(await cuentas.aprobarCompra('no-existe', 'T-1', 1, 'NEQUI')).toBe('no_existe');
    expect(await cuentas.aprobarCompra(ref, `T-${ref}`, 9_000_000, 'NEQUI')).toBe('aprobada');
    expect(await cuentas.aprobarCompra(ref, `T-${ref}`, 9_000_000, 'NEQUI')).toBe('ya_aprobada');
    expect((await cuentas.saldos(a.id)).full).toBe(2);

    const r = await request(app).post('/api/consultas').set(auth(a.token)).send({
      tipo: 'full', placa: 'ABC123', docType: 'CC', docNumber: '1020304050', consentimiento: { aceptado: true, version: '2026-10' }
    });
    expect(r.status).toBe(202);
    await servicio.esperarProcesos();

    const e = await request(app).get(`/api/consultas/${r.body.id}`).set(auth(a.token));
    expect(e.body.estado).toBe('completada');
    expect(e.body.resultado.codigoVerificacion).toMatch(/^CSR-/);
    expect((await cuentas.saldos(a.id)).full).toBe(1);

    const pdf = await request(app).get(`/api/consultas/${r.body.id}/pdf`).set(auth(a.token)).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (d: Buffer) => partes.push(d));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).equals(PDF)).toBe(true);

    // El otro usuario no lo ve, y en la base no queda el documento en claro.
    expect((await request(app).get(`/api/consultas/${r.body.id}`).set(auth(b.token))).status).toBe(404);
    expect((await request(app).get(`/api/consultas/${r.body.id}/pdf`).set(auth(b.token))).status).toBe(404);
    const { data: fila } = await db.from('consultas').select('*, consentimientos(*)').eq('id', r.body.id).single();
    expect(JSON.stringify(fila)).not.toContain('1020304050');
    expect(fila.consentimientos.version_aviso).toBe('2026-10');

    // Vencimiento: se borran el PDF y el informe, y queda el registro.
    reloj = new Date(Date.now() + 9 * 86_400_000);
    expect((await request(app).get(`/api/consultas/${r.body.id}/pdf`).set(auth(a.token))).status).toBe(410);
    expect(await servicio.limpiarVencidas()).toBeGreaterThanOrEqual(1);
    reloj = null;
    const { data: vencida } = await db.from('consultas').select('estado, informe, pdf_clave').eq('id', r.body.id).single();
    expect(vencida).toEqual({ estado: 'vencida', informe: null, pdf_clave: null });
    expect(await almacenamiento.leer(`${r.body.id}.pdf`)).toBeNull();
  });

  it('una consulta fallida devuelve el saldo una sola vez', async () => {
    const c = await request(app).post('/api/compras').set(auth(b.token)).send({ tipo: 'full', cantidad: 1 });
    await request(app).post(`/api/dev/compras/${c.body.compra.id}/aprobar`).set(auth(b.token));
    const r = await request(app).post('/api/consultas').set(auth(b.token)).send({
      tipo: 'full', placa: 'ABC123', docType: 'CC', docNumber: '0000000409', consentimiento: { aceptado: true, version: '2026-10' }
    });
    await servicio.esperarProcesos();
    const e = await request(app).get(`/api/consultas/${r.body.id}`).set(auth(b.token));
    expect(e.body.error).toMatchObject({ codigo: 'documento_no_coincide', saldoDevuelto: true });
    expect((await cuentas.saldos(b.id)).full).toBe(1);
    expect(await cuentas.devolverSaldo(r.body.id)).toBe(false);
    expect((await cuentas.saldos(b.id)).full).toBe(1);
  });

  it('peticiones simultáneas nunca dejan el saldo negativo ni gastan de más', async () => {
    const c = await crearUsuario();
    const compra = await request(app).post('/api/compras').set(auth(c.token)).send({ tipo: 'vin', cantidad: 3 });
    await request(app).post(`/api/dev/compras/${compra.body.compra.id}/aprobar`).set(auth(c.token));
    const intentos = Array.from({ length: 12 }, () => cuentas.consumirSaldo(c.id, 'vin', randomUUID()));
    const resultados = await Promise.all(intentos);
    expect(resultados.filter(Boolean)).toHaveLength(3);
    expect((await cuentas.saldos(c.id)).vin).toBe(0);
  });

  it('dos aprobaciones simultáneas de la misma compra acreditan una vez', async () => {
    const c = await crearUsuario();
    const compra = await request(app).post('/api/compras').set(auth(c.token)).send({ tipo: 'full', cantidad: 4 });
    const ref = compra.body.widget.reference;
    const monto = compra.body.widget.amountInCents;
    const r = await Promise.all(Array.from({ length: 5 }, () => cuentas.aprobarCompra(ref, `T-${ref}`, monto, 'PSE')));
    expect(r.filter((x) => x === 'aprobada')).toHaveLength(1);
    expect((await cuentas.saldos(c.id)).full).toBe(4);
  });
});
