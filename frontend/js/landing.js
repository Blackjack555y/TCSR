// Landing: lleva la placa a la consulta. El registro y la compra los pide esa página.

import { $, $$, iniciarPagina, mostrarError } from './ui.js';

// Mismos formatos que backend/src/api/validacion.ts.
const PLACA_RE = /^(?:[A-Z]{3}\d{3}|[A-Z]{3}\d{2}[A-Z]?|[A-Z]{4}\d{2}|[RS]\d{5})$/;

const limpiar = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const entrada = $('#plate');
const caja = $('.plate');
const error = $('#plate-error');

iniciarPagina();

entrada.addEventListener('input', () => {
  entrada.value = limpiar(entrada.value);
  if (!error.hidden && PLACA_RE.test(entrada.value)) {
    mostrarError(error);
    caja.classList.remove('is-invalid');
    entrada.setAttribute('aria-invalid', 'false');
  }
});

$('#plate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const placa = limpiar(entrada.value);
  if (PLACA_RE.test(placa)) {
    location.href = `consultar.html?placa=${placa}`;
    return;
  }
  mostrarError(error, placa
    ? 'Revisa la placa: 3 letras y 3 números para carro (ABC123) o 3 letras, 2 números y una letra para moto (ABC12D).'
    : 'Escribe la placa del vehículo.');
  caja.classList.add('is-invalid');
  entrada.setAttribute('aria-invalid', 'true');
  entrada.focus();
});

$$('[data-focus-plate]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  $('#inicio').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  setTimeout(() => entrada.focus({ preventScroll: true }), 400);
}));
