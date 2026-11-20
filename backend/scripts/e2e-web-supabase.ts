// Recorre el sitio en un navegador real contra Supabase (local) y el backend con Supabase.
// Intercepta el widget de Wompi para revisar lo que recibe y simula el webhook firmado.
// Requiere: backend en :3000 con SUPABASE_URL/SUPABASE_LLAVE_SECRETA y WOMPI_SECRETO_EVENTOS=secreto-eventos-e2e,
// el sitio servido en :5173, y SUPABASE_PRUEBAS_URL, SUPABASE_PRUEBAS_LLAVE y SUPABASE_PRUEBAS_ANON.

import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const SB = process.env.SUPABASE_PRUEBAS_URL!;
const KEY = process.env.SUPABASE_PRUEBAS_LLAVE!;
const ANON = process.env.SUPABASE_PRUEBAS_ANON!;
const EV = process.env.WOMPI_SECRETO_EVENTOS ?? 'secreto-eventos-e2e';
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

let pasos = 0;
const ok = (c: unknown, m: string) => {
  if (!c) throw new Error(`FALLÓ: ${m}`);
  pasos++;
  console.log('  ok ·', m);
};

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
try {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const config = `export const CONFIG={API_URL:'${API}',SUPABASE_URL:'${SB}',SUPABASE_LLAVE_PUBLICA:'${ANON}',TURNSTILE_LLAVE_SITIO:''};export const AVISO_VERSION='2026-11';export const MODO_DESARROLLO=false;`;
  await ctx.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
  // Widget falso: guarda lo que recibe y termina el pago con una transacción conocida.
  await ctx.route('https://checkout.wompi.co/widget.js', (r) => r.fulfill({ contentType: 'text/javascript',
    body: `window.WidgetCheckout=class{constructor(o){sessionStorage.setItem('w',JSON.stringify(o))}open(cb){setTimeout(()=>cb({transaction:{id:'T-NAV'}}),300)}}` }));

  const p = await ctx.newPage();
  const errores: string[] = [];
  p.on('pageerror', (e) => errores.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|status of 4\d\d/.test(m.text())) errores.push(m.text()); });

  const correo = `nav-${Date.now()}@ejemplo.com`;
  const clave = 'clave-navegador-1';
  await p.goto(`${BASE}/registro.html`);
  ok(!(await p.locator('.dev-banner').count()), 'sin aviso de desarrollo');
  await p.fill('#nombre', 'Beto Prueba'); await p.fill('#email', correo); await p.fill('#clave', clave); await p.check('#acepto');
  await p.click('button[type=submit]');
  await p.waitForSelector('#confirmar:not([hidden])');
  ok(true, 'el registro pide confirmar el correo');

  await p.goto(`${BASE}/ingresar.html`);
  await p.fill('#email', correo); await p.fill('#clave', clave); await p.click('button[type=submit]');
  await p.waitForSelector('#error:not([hidden])');
  ok((await p.textContent('#error'))!.includes('Confirma'), 'sin confirmar no deja ingresar');

  const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
  const usuarios = (await (await fetch(`${SB}/auth/v1/admin/users?per_page=200`, { headers: h })).json()) as { users: { id: string; email: string }[] };
  const u = usuarios.users.find((x) => x.email === correo)!;
  await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ email_confirm: true }) });
  await p.fill('#clave', clave); await p.click('button[type=submit]');
  await p.waitForURL(/panel\.html/); await p.waitForSelector('.saldo-card');
  ok((await p.textContent('#saludo'))!.includes('Beto'), 'ingresa con sesión real y lee su perfil');

  await p.goto(`${BASE}/comprar.html?tipo=basico`);
  await p.fill('#cantidad', '6');
  await p.waitForFunction(() => document.querySelector('#total')?.textContent?.includes('105.000'));
  await p.click('#pagar');
  await p.waitForURL(/compra-resultado\.html/);
  const w = JSON.parse((await p.evaluate(() => sessionStorage.getItem('w')))!);
  ok(w.amountInCents === 10_500_000 && w.signature.integrity.length === 64 && w.customerData.email === correo, 'el widget recibe monto, firma y correo');
  ok(p.url().includes('transaccion=T-NAV'), 'la página de resultado recibe la transacción de Wompi');

  const tx = { id: 'T-NAV', status: 'APPROVED', reference: w.reference, amount_in_cents: w.amountInCents, payment_method_type: 'NEQUI' };
  const ts = 1_730_000_000;
  const checksum = createHash('sha256').update(`T-NAVAPPROVED${w.amountInCents}${ts}${EV}`).digest('hex');
  const r = await fetch(`${API}/api/webhooks/wompi`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'transaction.updated', data: { transaction: tx }, timestamp: ts, signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum } }) });
  ok(r.status === 200, 'webhook firmado aceptado');
  await p.waitForFunction(() => document.querySelector('#titulo')?.textContent?.includes('aprobado'), undefined, { timeout: 15_000 });
  ok(true, 'la página detecta el pago aprobado');

  await p.click('#acciones a');
  await p.waitForSelector('input[name=tipo][value=basico]:checked');
  await p.fill('#placa', 'ALE123'); await p.check('input[name=consent][value=si]'); await p.click('#enviar');
  await p.waitForSelector('#resultado:not([hidden])', { timeout: 30_000 });
  await p.waitForSelector('#visor canvas', { timeout: 30_000 });
  ok((await p.textContent('#c-titulo'))!.includes('Atención'), 'genera el informe con el PDF en el bucket privado');

  await p.goto(`${BASE}/cuenta.html`);
  await p.waitForFunction(() => (document.querySelector('#nombre') as HTMLInputElement | null)?.value === 'Beto Prueba');
  await p.selectOption('#tipo', 'CC'); await p.fill('#numero', '123456'); await p.click('#form button[type=submit]');
  await p.waitForSelector('#guardado:not([hidden])');
  await p.reload();
  await p.waitForFunction(() => (document.querySelector('#numero') as HTMLInputElement | null)?.value === '123456');
  ok(true, 'el perfil se guarda con las reglas de seguridad de Supabase');

  await p.goto(`${BASE}/recuperar.html`);
  await p.fill('#email', correo); await p.click('button[type=submit]');
  await p.waitForSelector('#enviado:not([hidden])');
  ok(true, 'la recuperación de contraseña responde');

  ok(errores.length === 0, `sin errores en consola ${errores.join(' | ')}`);
  console.log(`\nTodo bien: ${pasos} comprobaciones.`);
} finally {
  await b.close();
}
