import { ingresar } from './sesion.js';
import { $, iniciarPagina, mostrarError, ocupado, volverSeguro } from './ui.js';

const u = await iniciarPagina();
const destino = volverSeguro('panel.html');
if (u) location.replace(destino);

$('#a-registro').href = `registro.html?volver=${encodeURIComponent(destino)}`;

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const boton = $('button[type=submit]', e.target);
  mostrarError($('#error'));
  ocupado(boton, true, 'Ingresando…');
  try {
    await ingresar({ email: $('#email').value.trim(), clave: $('#clave').value });
    location.href = destino;
  } catch (err) {
    mostrarError($('#error'), err.message);
    ocupado(boton, false);
  }
});
