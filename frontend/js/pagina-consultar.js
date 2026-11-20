import { api, ErrorApi } from './api.js';
import { AVISO_VERSION, CONFIG } from './config.js';
import { $, $$, esc, iniciarPagina, mostrarError, ocupado, requerirSesion, TIPOS } from './ui.js';

await requerirSesion('registro.html');
await iniciarPagina();

// Mismas reglas que backend/src/api/validacion.ts.
const PLACA_RE = /^(?:[A-Z]{3}\d{3}|[A-Z]{3}\d{2}[A-Z]?|[A-Z]{4}\d{2}|[RS]\d{5})$/;
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const DOC = {
  CC: { re: /^\d{3,11}$/, msg: 'La cédula solo lleva números, sin puntos ni espacios.' },
  CE: { re: /^\d{3,11}$/, msg: 'La cédula de extranjería solo lleva números.' },
  NIT: { re: /^\d{9,10}$/, msg: 'Escribe el NIT sin dígito de verificación, solo números.' },
  PA: { re: /^[A-Z0-9]{4,15}$/, msg: 'Revisa el pasaporte: solo letras y números.' },
  PPT: { re: /^[A-Z0-9]{4,15}$/, msg: 'Revisa el número del PPT: solo letras y números.' }
};

const params = new URLSearchParams(location.search);
const limpiar = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
let saldos = { basico: 0, vin: 0, full: 0 };
let tokenHumano = null;

$('#placa').value = limpiar(params.get('placa') ?? '');

function pintarTipos(inicial) {
  $('#tipos').insertAdjacentHTML('beforeend', Object.entries(TIPOS).map(([k, t]) => `
    <label class="opcion">
      <input type="radio" name="tipo" value="${k}" ${k === inicial ? 'checked' : ''}>
      <span class="opcion-nombre"><span>${t.nombre}</span><span class="opcion-dato">${saldos[k]} en tu saldo</span></span>
      <span class="opcion-texto"><strong>Pide:</strong> ${esc(t.pide)}.</span>
      <span class="opcion-texto">${esc(t.incluye)} ${esc(t.falta)}</span>
    </label>`).join(''));
  $$('input[name=tipo]').forEach((r) => r.addEventListener('change', actualizar));
}

const tipoActual = () => $('input[name=tipo]:checked')?.value;

function datosValidos() {
  const tipo = tipoActual();
  if (tipo === 'vin') return VIN_RE.test(limpiar($('#vin').value));
  if (!PLACA_RE.test(limpiar($('#placa').value))) return false;
  return tipo !== 'full' || DOC[$('#doc-type').value].re.test(limpiar($('#doc-number').value));
}

function actualizar() {
  const tipo = tipoActual();
  const consent = $('input[name=consent]:checked')?.value;
  $('#f-placa').hidden = tipo === 'vin';
  $('#f-vin').hidden = tipo !== 'vin';
  $('#f-doc').hidden = tipo !== 'full';
  $('#consent-msg').hidden = consent !== 'no';

  const conSaldo = saldos[tipo] > 0;
  $('#sin-saldo').hidden = conSaldo;
  const volver = `consultar.html?tipo=${tipo}${$('#placa').value ? `&placa=${limpiar($('#placa').value)}` : ''}`;
  $('#a-comprar').href = `comprar.html?tipo=${tipo}&volver=${encodeURIComponent(volver)}`;

  const humano = !CONFIG.TURNSTILE_LLAVE_SITIO || tokenHumano;
  $('#enviar').disabled = !(conSaldo && consent === 'si' && datosValidos() && humano);
}

function validarCampo(input, error, ok, mensaje) {
  const mal = input.value !== '' && !ok;
  mostrarError(error, mal ? mensaje : '');
  input.setAttribute('aria-invalid', String(mal));
}

$('#placa').addEventListener('input', (e) => { e.target.value = limpiar(e.target.value).slice(0, 6); actualizar(); });
$('#vin').addEventListener('input', (e) => { e.target.value = limpiar(e.target.value).slice(0, 17); actualizar(); });
$('#doc-number').addEventListener('input', actualizar);
$('#doc-type').addEventListener('change', (e) => {
  $('#doc-number').inputMode = ['PA', 'PPT'].includes(e.target.value) ? 'text' : 'numeric';
  actualizar();
});
$$('input[name=consent]').forEach((r) => r.addEventListener('change', actualizar));

$('#placa').addEventListener('blur', (e) => validarCampo(e.target, $('#e-placa'), PLACA_RE.test(e.target.value), 'Revisa la placa: 3 letras y 3 números para carro, o 3 letras, 2 números y una letra para moto.'));
$('#vin').addEventListener('blur', (e) => validarCampo(e.target, $('#e-vin'), VIN_RE.test(e.target.value), 'El VIN tiene 17 caracteres y no usa las letras I, O ni Q.'));
$('#doc-number').addEventListener('blur', (e) => {
  const d = DOC[$('#doc-type').value];
  validarCampo(e.target, $('#e-doc'), d.re.test(limpiar(e.target.value)), d.msg);
});

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const boton = $('#enviar');
  if (boton.disabled) return;

  const tipo = tipoActual();
  const cuerpo = {
    tipo,
    consentimiento: { aceptado: true, version: AVISO_VERSION },
    ...(tokenHumano && { turnstileToken: tokenHumano }),
    ...(tipo === 'vin' ? { vin: limpiar($('#vin').value) } : { placa: limpiar($('#placa').value) }),
    ...(tipo === 'full' && { docType: $('#doc-type').value, docNumber: limpiar($('#doc-number').value) })
  };

  mostrarError($('#error'));
  ocupado(boton, true, 'Iniciando la consulta…');
  try {
    const c = await api.crearConsulta(cuerpo);
    location.href = `informe.html?id=${c.id}`;
  } catch (err) {
    if (err instanceof ErrorApi && err.codigo === 'sin_saldo') {
      saldos[tipo] = 0;
    } else {
      mostrarError($('#error'), err.message);
    }
    ocupado(boton, false);
    actualizar();
    window.turnstile?.reset();
  }
});

function iniciarTurnstile() {
  if (!CONFIG.TURNSTILE_LLAVE_SITIO) return;
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.onload = () => window.turnstile.ready(() => window.turnstile.render('#turnstile', {
    sitekey: CONFIG.TURNSTILE_LLAVE_SITIO,
    language: 'es',
    callback: (t) => { tokenHumano = t; actualizar(); },
    'expired-callback': () => { tokenHumano = null; actualizar(); }
  }));
  document.head.append(s);
}

try {
  ({ saldos } = await api.saldo());
} catch (err) {
  mostrarError($('#error'), err.message);
}
const pedido = params.get('tipo');
const mejor = ['full', 'vin', 'basico'].find((k) => saldos[k] > 0) ?? 'full';
pintarTipos(TIPOS[pedido] ? pedido : mejor);
iniciarTurnstile();
actualizar();
