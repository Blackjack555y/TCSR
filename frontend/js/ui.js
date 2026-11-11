// Piezas compartidas por las páginas de la aplicación.

import { MODO_DESARROLLO } from './config.js';
import { salir, usuarioActual } from './sesion.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const pesos = (n) => `$ ${new Intl.NumberFormat('es-CO').format(n)}`;
export const fecha = (iso) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium' }).format(new Date(iso));
export const fechaHora = (iso) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICONOS = {
  ok: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  revision: '<circle cx="12" cy="12" r="10"/><path d="M12 7v6"/><path d="M12 17h.01"/>',
  na: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
  alerta: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  flecha: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  descarga: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'
};
export const icono = (k) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONOS[k]}</svg>`;

export const TIPOS = {
  basico: { nombre: 'Básico', pide: 'Solo la placa', incluye: 'Reportes de hurto, reclamaciones a aseguradoras y prendas.', falta: 'No identifica el vehículo ni incluye SOAT, tecnomecánica, embargos ni multas.', fuentes: ['Reportes de hurto', 'Aseguradoras', 'Prendas'] },
  vin: { nombre: 'Por VIN', pide: 'Solo el VIN', incluye: 'Ficha del vehículo, SOAT, tecnomecánica, embargos, regrabados, avalúo, hurto y reclamaciones.', falta: 'No incluye multas del SIMIT, impuestos ni historial de propietarios.', fuentes: ['RUNT', 'FASECOLDA', 'Reportes de hurto', 'Aseguradoras'] },
  full: { nombre: 'Full', pide: 'Placa y cédula del propietario', incluye: 'Todo lo anterior, más multas del SIMIT, impuestos e historial de propietarios.', falta: 'Necesitas la cédula del propietario actual: pídesela al vendedor.', fuentes: ['RUNT', 'SIMIT', 'Impuestos', 'FASECOLDA', 'Reportes de hurto', 'Aseguradoras'] }
};

const ESTADOS_CONSULTA = {
  en_curso: ['pending', 'revision', 'En curso'],
  generando_pdf: ['pending', 'revision', 'Generando PDF'],
  completada: ['ok', 'ok', 'Lista'],
  error: ['alert', 'alerta', 'No se completó'],
  vencida: ['na', 'na', 'Vencida']
};
export function etiquetaConsulta(estado) {
  const [clase, ic, texto] = ESTADOS_CONSULTA[estado] ?? ['na', 'na', estado];
  return `<span class="state" data-state="${clase}">${icono(ic)}${texto}</span>`;
}

/** Solo rutas internas: evita redirigir a otro sitio con ?volver=. */
export function volverSeguro(porDefecto) {
  const v = new URLSearchParams(location.search).get('volver');
  return v && /^[a-z0-9-]+\.html(\?[\w=&%.-]*)?$/i.test(v) ? v : porDefecto;
}

const paginaActual = () => location.pathname.split('/').pop() + location.search;

export function mostrarError(el, mensaje) {
  el.textContent = mensaje ?? '';
  el.hidden = !mensaje;
}

export function ocupado(boton, activo, texto) {
  boton.dataset.original ??= boton.innerHTML;
  boton.disabled = activo;
  boton.setAttribute('aria-busy', String(activo));
  boton.innerHTML = activo ? `<span>${texto}</span>` : boton.dataset.original;
}

/** Sin sesión, manda a la página indicada y vuelve aquí después. */
export async function requerirSesion(destino = 'ingresar.html') {
  const u = await usuarioActual();
  if (!u) {
    location.replace(`${destino}?volver=${encodeURIComponent(paginaActual())}`);
    return new Promise(() => {});
  }
  return u;
}

/** Pinta la navegación y el aviso de modo de desarrollo. */
export async function iniciarPagina() {
  const nav = $('#nav') ?? $('#nav-sesion');
  const u = await usuarioActual();
  if (nav) {
    nav.innerHTML = u
      ? `<a href="panel.html">Panel</a><a href="consultar.html">Consultar</a><a href="comprar.html">Comprar</a><a href="cuenta.html">Mi cuenta</a><button type="button" class="link-btn nav-salir" id="salir">Salir</button>`
      : `<a href="comprar.html">Precios</a><a href="ingresar.html">Ingresar</a><a class="nav-cta" href="registro.html">Crear cuenta</a>`;
    $('#salir')?.addEventListener('click', async () => {
      await salir();
      location.href = 'index.html';
    });
  }
  if (MODO_DESARROLLO) {
    document.body.insertAdjacentHTML('afterbegin', '<p class="dev-banner">Modo de desarrollo: cuentas de prueba y pagos simulados.</p>');
  }
  return u;
}
