import { pedirRecuperacion } from './sesion.js';
import { $, iniciarPagina, mostrarError, ocupado } from './ui.js';

await iniciarPagina();

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#email').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return mostrarError($('#error'), 'Escribe un correo válido.');
  const boton = $('button[type=submit]', e.target);
  mostrarError($('#error'));
  ocupado(boton, true, 'Enviando…');
  try {
    await pedirRecuperacion(email);
    e.target.hidden = true;
    $('#enviado').hidden = false;
  } catch (err) {
    mostrarError($('#error'), err.message);
    ocupado(boton, false);
  }
});
