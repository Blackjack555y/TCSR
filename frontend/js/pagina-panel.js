import { api } from './api.js';
import { leerPerfil } from './sesion.js';
import { $, esc, etiquetaConsulta, fechaHora, iniciarPagina, mostrarError, requerirSesion, TIPOS } from './ui.js';

await requerirSesion();
await iniciarPagina();

leerPerfil().then((p) => {
  const nombre = p.nombre?.split(' ')[0];
  if (nombre) $('#saludo').textContent = `, ${nombre}`;
}).catch(() => {});

try {
  const [{ saldos }, { consultas }] = await Promise.all([api.saldo(), api.consultas()]);

  $('#saldos').innerHTML = Object.entries(TIPOS).map(([tipo, t]) => `
    <article class="card saldo-card">
      <h3 class="card-title" style="margin:0">${t.nombre}</h3>
      <p class="saldo-num">${saldos[tipo]}</p>
      <p class="muted small">${saldos[tipo] === 1 ? 'informe disponible' : 'informes disponibles'}</p>
      ${saldos[tipo] > 0
        ? `<a class="btn-cta" href="consultar.html?tipo=${tipo}"><span>Consultar</span></a>`
        : `<a class="btn-secondary" href="comprar.html?tipo=${tipo}">Comprar</a>`}
    </article>`).join('');

  $('#consultas').innerHTML = consultas.length === 0
    ? `<p class="vacio">Todavía no has hecho consultas.</p>`
    : `<ul class="lista">${consultas.map((c) => `
      <li>
        <div class="lista-info">
          <p class="lista-titulo">${esc(c.placa ?? c.vin ?? 'Consulta')} ${etiquetaConsulta(c.estado)}</p>
          <p class="lista-meta">Informe ${TIPOS[c.tipo].nombre} · ${fechaHora(c.creadaEn)}</p>
        </div>
        ${c.estado === 'vencida' ? '' : `<a class="ver" href="informe.html?id=${c.id}">Ver</a>`}
      </li>`).join('')}</ul>`;
} catch (err) {
  mostrarError($('#error'), err.message);
}
