import { api } from './api.js';
import { MODO_DESARROLLO } from './config.js';
import { usuarioActual } from './sesion.js';
import { $, $$, esc, iniciarPagina, mostrarError, ocupado, pesos, TIPOS } from './ui.js';

const usuario = await iniciarPagina();
const params = new URLSearchParams(location.search);
const volver = params.get('volver');
const inicial = TIPOS[params.get('tipo')] ? params.get('tipo') : 'full';

const entrada = $('#cantidad');
let rangos = [];

$('#tipos').insertAdjacentHTML('beforeend', Object.entries(TIPOS).map(([k, t]) => `
  <label class="opcion">
    <input type="radio" name="tipo" value="${k}" ${k === inicial ? 'checked' : ''}>
    <span class="opcion-nombre"><span>${t.nombre}</span><span class="opcion-dato" data-desde="${k}"></span></span>
    <span class="opcion-texto"><strong>Pide:</strong> ${esc(t.pide)}. ${esc(t.incluye)}</span>
    <span class="opcion-texto">${esc(t.falta)}</span>
  </label>`).join(''));

const tipoActual = () => $('input[name=tipo]:checked').value;

function cantidadActual() {
  const n = Math.floor(Number(entrada.value));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1;
}

let turno = 0;
async function cotizar() {
  const miTurno = ++turno;
  try {
    const c = await api.cotizar(tipoActual(), cantidadActual());
    if (miTurno !== turno) return;
    mostrarError($('#error'));
    $('#segmento').textContent = c.segmento;
    $('#unitario').textContent = pesos(c.precioUnitario);
    $('#total').textContent = pesos(c.total);
    $('#mejor').hidden = !c.mejorOpcion;
    if (c.mejorOpcion) {
      $('#mejor-texto').textContent = `Por ${pesos(c.mejorOpcion.total)} te llevas ${c.mejorOpcion.cantidad} informes: ahorras ${pesos(c.mejorOpcion.ahorro)}.`;
      $('#usar-mejor').dataset.cantidad = c.mejorOpcion.cantidad;
    }
  } catch (err) {
    if (miTurno === turno) mostrarError($('#error'), err.message);
  }
}

function pintarTabla() {
  const filas = rangos.map((r) => `<tr>
    <td>${esc(r.segmento)}</td>
    <td>${r.hasta ? `${r.desde} a ${r.hasta}` : `${r.desde} o más`}</td>
    <td class="n">${pesos(r.precios.basico)}</td><td class="n">${pesos(r.precios.vin)}</td><td class="n">${pesos(r.precios.full)}</td>
  </tr>`).join('');
  $('#tabla').innerHTML = `<thead><tr><th>Plan</th><th>Informes por compra</th><th class="n">Básico</th><th class="n">Por VIN</th><th class="n">Full</th></tr></thead><tbody>${filas}</tbody>`;
  for (const el of $$('[data-desde]')) el.textContent = `desde ${pesos(rangos.at(-1).precios[el.dataset.desde])}`;
}

$$('input[name=tipo]').forEach((r) => r.addEventListener('change', cotizar));
entrada.addEventListener('input', cotizar);
$('#menos').addEventListener('click', () => { entrada.value = Math.max(1, cantidadActual() - 1); cotizar(); });
$('#mas').addEventListener('click', () => { entrada.value = cantidadActual() + 1; cotizar(); });
$('#usar-mejor').addEventListener('click', (e) => { entrada.value = e.target.dataset.cantidad; cotizar(); });

const destinoResultado = (id) => `compra-resultado.html?compra=${id}${volver ? `&volver=${encodeURIComponent(volver)}` : ''}`;

function cargarWompi() {
  return new Promise((resolver, rechazar) => {
    if (window.WidgetCheckout) return resolver();
    const s = document.createElement('script');
    s.src = 'https://checkout.wompi.co/widget.js';
    s.onload = resolver;
    s.onerror = () => rechazar(new Error('No pudimos abrir la pasarela de pagos. Intenta de nuevo.'));
    document.head.append(s);
  });
}

$('#pagar').addEventListener('click', async () => {
  const boton = $('#pagar');
  if (!usuario) {
    const aqui = `comprar.html?tipo=${tipoActual()}`;
    location.href = `registro.html?volver=${encodeURIComponent(aqui)}`;
    return;
  }
  mostrarError($('#error'));
  ocupado(boton, true, 'Preparando el pago…');
  try {
    const { compra, widget } = await api.crearCompra(tipoActual(), cantidadActual());

    if (MODO_DESARROLLO) {
      await api.aprobarCompraDesarrollo(compra.id);
      location.href = destinoResultado(compra.id);
      return;
    }

    await cargarWompi();
    const u = await usuarioActual();
    new window.WidgetCheckout({
      currency: widget.currency,
      amountInCents: widget.amountInCents,
      reference: widget.reference,
      publicKey: widget.publicKey,
      signature: { integrity: widget.signatureIntegrity },
      redirectUrl: new URL(destinoResultado(compra.id), location.href).href,
      customerData: { email: u.email }
    }).open((resultado) => {
      // El servidor confirma el pago con Wompi; esta página solo le pasa el id de la transacción.
      const tx = resultado?.transaction?.id;
      location.href = destinoResultado(compra.id) + (tx ? `&transaccion=${encodeURIComponent(tx)}` : '');
    });
    ocupado(boton, false);
  } catch (err) {
    mostrarError($('#error'), err.message);
    ocupado(boton, false);
  }
});

try {
  ({ rangos } = await api.precios());
  pintarTabla();
  await cotizar();
} catch (err) {
  mostrarError($('#error'), err.message);
}
