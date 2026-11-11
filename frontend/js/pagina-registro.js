import { registrar } from './sesion.js';
import { $, iniciarPagina, mostrarError, ocupado, volverSeguro } from './ui.js';

const u = await iniciarPagina();
const destino = volverSeguro('comprar.html');
if (u) location.replace(destino);

$('#a-ingresar').href = `ingresar.html?volver=${encodeURIComponent(destino)}`;

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = $('#nombre').value.trim();
  const email = $('#email').value.trim();
  const clave = $('#clave').value;
  const boton = $('button[type=submit]', e.target);

  if (!nombre) return mostrarError($('#error'), 'Escribe tu nombre.');
  if (!/^\S+@\S+\.\S+$/.test(email)) return mostrarError($('#error'), 'Escribe un correo válido.');
  if (clave.length < 8) return mostrarError($('#error'), 'La contraseña debe tener al menos 8 caracteres.');
  if (!$('#acepto').checked) return mostrarError($('#error'), 'Debes aceptar los términos y el aviso de privacidad.');

  mostrarError($('#error'));
  ocupado(boton, true, 'Creando cuenta…');
  try {
    const r = await registrar({ nombre, email, clave });
    if (r.sesion) {
      location.href = destino;
      return;
    }
    e.target.hidden = true;
    $('#confirmar').hidden = false;
  } catch (err) {
    mostrarError($('#error'), err.message);
    ocupado(boton, false);
  }
});
