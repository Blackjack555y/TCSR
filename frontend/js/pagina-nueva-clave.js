import { cambiarClave } from './sesion.js';
import { $, iniciarPagina, mostrarError, ocupado } from './ui.js';

await iniciarPagina();

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const clave = $('#clave').value;
  if (clave.length < 8) return mostrarError($('#error'), 'La contraseña debe tener al menos 8 caracteres.');
  const boton = $('button[type=submit]', e.target);
  mostrarError($('#error'));
  ocupado(boton, true, 'Guardando…');
  try {
    await cambiarClave(clave);
    location.href = 'panel.html';
  } catch (err) {
    mostrarError($('#error'), err.message);
    ocupado(boton, false);
  }
});
