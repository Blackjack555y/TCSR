// Recorre el sitio como un usuario, en un navegador real, contra el backend en modo simulado.
// Antes: arrancar el backend en el puerto 3000 con CHROME_PATH o el Chromium de Playwright.
// Uso: npm run e2e:web   (E2E_CAPTURAS=carpeta guarda capturas)

import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';

const RAIZ = resolve(import.meta.dirname, '../../frontend');
const PUERTO = 5173;
const BASE = `http://localhost:${PUERTO}`;
const CAPTURAS = process.env.E2E_CAPTURAS;

const TIPOS_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.png': 'image/png'
};

const servidor = createServer((req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url!, BASE).pathname)).replace(/^(\.\.[/\\])+/, '');
  const archivo = join(RAIZ, ruta === '/' ? 'index.html' : ruta);
  if (!existsSync(archivo) || !statSync(archivo).isFile()) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    createReadStream(join(RAIZ, '404.html')).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': TIPOS_MIME[extname(archivo)] ?? 'application/octet-stream' });
  createReadStream(archivo).pipe(res);
});
await new Promise<void>((r) => servidor.listen(PUERTO, r));

let pasos = 0;
function ok(condicion: unknown, mensaje: string) {
  if (!condicion) throw new Error(`FALLÓ: ${mensaje}`);
  pasos++;
  console.log(`  ok · ${mensaje}`);
}

const navegador = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const errores: string[] = [];

function vigilar(p: Page) {
  p.on('pageerror', (e) => errores.push(`pageerror ${p.url()}: ${e.message}`));
  p.on('console', (m) => {
    // Las fuentes de Google y los 4xx esperados no son errores del sitio.
    if (m.type() === 'error' && !/fonts\.g|status of 4\d\d/.test(m.text())) errores.push(`console ${p.url()}: ${m.text()}`);
  });
}

async function captura(p: Page, nombre: string) {
  if (!CAPTURAS) return;
  await mkdir(CAPTURAS, { recursive: true });
  await p.screenshot({ path: join(CAPTURAS, `${nombre}.png`), fullPage: true });
}

try {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p = await contexto.newPage();
  vigilar(p);

  console.log('Landing y registro');
  await p.goto(`${BASE}/index.html`);
  await p.fill('#plate', 'abc-1');
  await p.click('#plate-form button[type=submit]');
  ok(await p.isVisible('#plate-error'), 'una placa inválida muestra el error');
  await p.fill('#plate', 'abc123');
  await captura(p, '01-landing');
  await p.click('#plate-form button[type=submit]');
  await p.waitForURL(/registro\.html/);
  ok(p.url().includes('volver='), 'sin sesión lleva al registro y recuerda volver');

  await p.fill('#nombre', 'Ana Prueba');
  await p.fill('#email', 'ana@ejemplo.com');
  await p.fill('#clave', 'clave-de-prueba');
  await p.click('button[type=submit]');
  ok(await p.isVisible('#error'), 'exige aceptar los términos');
  await p.check('#acepto');
  await captura(p, '02-registro');
  await p.click('button[type=submit]');
  await p.waitForURL(/consultar\.html\?placa=ABC123/);
  ok(await p.inputValue('#placa') === 'ABC123', 'la placa de la landing llega a la consulta');
  await p.waitForSelector('#sin-saldo:not([hidden])');
  ok(await p.isDisabled('#enviar'), 'sin saldo no se puede consultar');

  console.log('Compra');
  await p.click('#a-comprar');
  await p.waitForURL(/comprar\.html/);
  await p.waitForSelector('#tabla tbody tr');
  await p.fill('#cantidad', '5');
  await p.waitForFunction(() => document.querySelector('#total')?.textContent?.includes('225.000'));
  ok(true, '5 informes Full cuestan $ 225.000');
  await p.waitForSelector('#mejor:not([hidden])');
  await p.click('#usar-mejor');
  await p.waitForFunction(() => document.querySelector('#total')?.textContent?.includes('210.000'));
  ok(await p.inputValue('#cantidad') === '6', 'ofrece 6 por menos dinero que 5');
  await captura(p, '03-comprar');
  await p.click('#pagar');
  await p.waitForURL(/compra-resultado\.html/);
  await p.waitForFunction(() => document.querySelector('#titulo')?.textContent?.includes('aprobado'));
  ok(true, 'el pago simulado queda aprobado');
  await captura(p, '04-compra-aprobada');
  await p.click('#acciones a');
  await p.waitForURL(/consultar\.html/);
  ok(await p.inputValue('#placa') === 'ABC123', 'después de pagar vuelve a la consulta con la placa');

  console.log('Consulta con error de documento');
  await p.waitForSelector('#sin-saldo[hidden]', { state: 'attached' });
  await p.selectOption('#doc-type', 'CC');
  await p.fill('#doc-number', '0000000409');
  await p.check('input[name=consent][value=no]');
  ok(await p.isDisabled('#enviar') && await p.isVisible('#consent-msg'), 'sin autorización no se puede consultar');
  await p.check('input[name=consent][value=si]');
  await captura(p, '05-consultar');
  await p.click('#enviar');
  await p.waitForURL(/informe\.html/);
  await p.waitForSelector('#fallo:not([hidden])');
  ok((await p.textContent('#f-titulo'))?.includes('no coincide'), 'muestra que el documento no coincide');
  await captura(p, '06-error-documento');

  console.log('Consulta correcta');
  await p.goto(`${BASE}/consultar.html?tipo=full&placa=ABC123`);
  await p.waitForSelector('input[name=tipo]');
  ok((await p.textContent('.opcion:has(input[value=full]) .opcion-dato'))?.startsWith('6'), 'el error no gastó saldo');
  await p.fill('#doc-number', '1020304050');
  await p.check('input[name=consent][value=si]');
  await p.click('#enviar');
  await p.waitForURL(/informe\.html/);
  await p.waitForSelector('#progreso:not([hidden])', { timeout: 3000 }).catch(() => {});
  await captura(p, '07-cargando');
  await p.waitForSelector('#resultado:not([hidden])', { timeout: 30_000 });
  ok((await p.textContent('#c-titulo'))?.includes('Atención prioritaria'), 'muestra la conclusión');
  await p.waitForSelector('#visor canvas', { timeout: 30_000 });
  await p.waitForFunction(() => document.querySelectorAll('#visor canvas').length >= 3, undefined, { timeout: 30_000 });
  await p.waitForTimeout(800);
  const pintado = await p.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#visor canvas')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const colores = new Set<number>();
    for (let i = 0; i < d.length; i += 4000) colores.add(d[i]! * 65536 + d[i + 1]! * 256 + d[i + 2]!);
    return colores.size;
  });
  ok(pintado > 5, `la vista previa del PDF se pintó (${await p.locator('#visor canvas').count()} páginas)`);
  await captura(p, '08-informe');

  const [descarga] = await Promise.all([p.waitForEvent('download'), p.click('#descargar')]);
  ok(descarga.suggestedFilename() === 'informe-ABC123.pdf', 'descarga el PDF');

  console.log('Panel y cuenta');
  await p.goto(`${BASE}/panel.html`);
  await p.waitForSelector('.saldo-card');
  ok((await p.textContent('#saludo'))?.includes('Ana'), 'saluda por el nombre');
  ok((await p.textContent('.saldo-card:last-child .saldo-num')) === '5', 'el saldo Full bajó a 5');
  ok(await p.locator('#consultas li').count() === 2, 'el historial tiene las dos consultas');
  await captura(p, '09-panel');

  await p.goto(`${BASE}/cuenta.html`);
  await p.waitForSelector('#compras li');
  await p.fill('#telefono', '3001234567');
  await p.click('#form button[type=submit]');
  await p.waitForSelector('#guardado:not([hidden])');
  ok(true, 'guarda los datos de la cuenta');
  await captura(p, '10-cuenta');

  await p.click('#salir');
  await p.waitForURL(/index\.html/);
  await p.goto(`${BASE}/panel.html`);
  await p.waitForURL(/ingresar\.html/);
  ok(true, 'al salir, el panel exige ingresar');
  await p.fill('#email', 'ana@ejemplo.com');
  await p.fill('#clave', 'clave-de-prueba');
  await p.click('button[type=submit]');
  await p.waitForURL(/panel\.html/);
  await p.waitForSelector('.saldo-card');
  ok((await p.textContent('.saldo-card:last-child .saldo-num')) === '5', 'al volver a entrar conserva el saldo');

  await p.goto(`${BASE}/ingresar.html?volver=https://otro-sitio.com`);
  await p.waitForURL(/panel\.html/);
  ok(true, 'no redirige a sitios externos con ?volver=');

  console.log('Otros tipos de informe');
  await p.goto(`${BASE}/comprar.html?tipo=vin`);
  await p.waitForFunction(() => document.querySelector('#total')?.textContent?.includes('37.000'));
  await p.click('#pagar');
  await p.waitForFunction(() => document.querySelector('#titulo')?.textContent?.includes('aprobado'));
  await p.click('#acciones a');
  await p.waitForSelector('input[name=tipo][value=vin]:checked');
  ok(await p.isVisible('#vin') && !(await p.isVisible('#placa')), 'el informe Por VIN solo pide el VIN');
  await p.fill('#vin', '9fla37cz0ea000001');
  await p.check('input[name=consent][value=si]');
  await p.click('#enviar');
  await p.waitForSelector('#resultado:not([hidden])', { timeout: 30_000 });
  ok(true, 'genera el informe Por VIN');

  await p.goto(`${BASE}/no-existe.html`);
  ok((await p.textContent('h1'))?.includes('No encontramos'), 'la página 404 funciona');

  console.log('Celulares: sin desbordes horizontales');
  const paginas = ['index', 'registro', 'ingresar', 'recuperar', 'panel', 'comprar', 'consultar', 'cuenta', 'privacidad', 'terminos', '404'];
  for (const ancho of [320, 375, 768]) {
    await p.setViewportSize({ width: ancho, height: 740 });
    for (const n of paginas) {
      await p.goto(`${BASE}/${n}.html`);
      await p.waitForLoadState('networkidle').catch(() => {});
      const sobra = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (sobra > 0) throw new Error(`FALLÓ: ${n}.html se desborda ${sobra}px a ${ancho}px`);
      if (ancho === 320 && ['index', 'comprar', 'consultar', 'panel'].includes(n)) await captura(p, `movil-${n}`);
    }
  }
  ok(true, `${paginas.length} páginas sin desborde a 320, 375 y 768 px`);

  ok(errores.length === 0, `sin errores en consola${errores.length ? `:\n${errores.join('\n')}` : ''}`);
  console.log(`\nTodo bien: ${pasos} comprobaciones.`);
} finally {
  await navegador.close();
  servidor.close();
}
process.exit(0);
