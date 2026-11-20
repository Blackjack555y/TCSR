import { api } from './api.js';
import { guardarPerfil, leerPerfil } from './sesion.js';
import { $, esc, fecha, iniciarPagina, mostrarError, ocupado, pesos, requerirSesion, TIPOS } from './ui.js';

const u = await requerirSesion();
await iniciarPagina();
$('#correo').textContent = u.email;

const ESTADOS = { pendiente: ['pending', 'Pendiente'], aprobada: ['ok', 'Aprobada'], rechazada: ['alert', 'Rechazada'] };

try {
  const p = await leerPerfil();
  $('#nombre').value = p.nombre ?? '';
  $('#tipo').value = p.tipo_documento ?? '';
  $('#numero').value = p.numero_documento ?? '';
  $('#telefono').value = p.telefono ?? '';
} catch (err) {
  mostrarError($('#error'), err.message);
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const boton = $('button[type=submit]', e.target);
  mostrarError($('#error'));
  $('#guardado').hidden = true;
  ocupado(boton, true, 'Guardando…');
  try {
    await guardarPerfil({
      nombre: $('#nombre').value.trim() || null,
      tipo_documento: $('#tipo').value || null,
      numero_documento: $('#numero').value.trim() || null,
      telefono: $('#telefono').value.trim() || null
    });
    $('#guardado').hidden = false;
  } catch (err) {
    mostrarError($('#error'), err.message);
  }
  ocupado(boton, false);
});

try {
  const { compras } = await api.compras();
  $('#compras').innerHTML = compras.length === 0
    ? '<p class="vacio">Todavía no has hecho compras.</p>'
    : `<ul class="lista">${compras.map((c) => {
      const [clase, texto] = ESTADOS[c.estado];
      return `<li>
        <div class="lista-info">
          <p class="lista-titulo">${c.cantidad} × Informe ${esc(TIPOS[c.tipo].nombre)}</p>
          <p class="lista-meta">${fecha(c.creadaEn)} · ${pesos(c.total)}</p>
        </div>
        <span class="state" data-state="${clase}">${texto}</span>
      </li>`;
    }).join('')}</ul>`;
} catch (err) {
  $('#compras').innerHTML = `<p class="field-error">${esc(err.message)}</p>`;
}
