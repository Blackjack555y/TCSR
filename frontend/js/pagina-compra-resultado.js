import { api } from './api.js';
import { $, iniciarPagina, requerirSesion, volverSeguro } from './ui.js';

await requerirSesion();
await iniciarPagina();

const id = new URLSearchParams(location.search).get('compra');
const INTENTOS = 40;
const ESPERA_MS = 3000;

function terminar(titulo, texto, acciones) {
  $('.loader').hidden = true;
  $('#titulo').textContent = titulo;
  $('#texto').textContent = texto;
  $('#acciones').hidden = false;
  $('#acciones').innerHTML = acciones;
}

for (let i = 0; i < INTENTOS; i++) {
  try {
    const { compras } = await api.compras();
    const c = compras.find((x) => x.id === id);
    if (!c) {
      terminar('No encontramos esa compra', 'Revisa tus compras en tu cuenta.', '<a class="btn-secondary" href="cuenta.html">Ver mis compras</a>');
      break;
    }
    if (c.estado === 'aprobada') {
      const destino = volverSeguro(`consultar.html?tipo=${c.tipo}`);
      terminar('¡Pago aprobado!', `Ya tienes ${c.cantidad} ${c.cantidad === 1 ? 'informe' : 'informes'} en tu saldo.`, `<a class="btn-cta" href="${destino}"><span>Analizar un vehículo</span></a>`);
      break;
    }
    if (c.estado === 'rechazada') {
      terminar('El pago no se aprobó', 'No se hizo ningún cargo. Puedes intentarlo otra vez.', `<a class="btn-cta" href="comprar.html?tipo=${c.tipo}"><span>Intentar de nuevo</span></a>`);
      break;
    }
  } catch {
    // un fallo de red no cambia el estado del pago: se sigue intentando
  }
  if (i === INTENTOS - 1) {
    terminar('Tu pago sigue en confirmación', 'Algunos medios de pago tardan más. El saldo aparecerá en tu panel apenas se apruebe.', '<a class="btn-secondary" href="panel.html">Ir al panel</a>');
    break;
  }
  await new Promise((r) => setTimeout(r, ESPERA_MS));
}
