import { api } from './api.js';
import { $, esc, fechaHora, icono, iniciarPagina, mostrarError, ocupado, requerirSesion, TIPOS } from './ui.js';

await requerirSesion();
await iniciarPagina();

const id = new URLSearchParams(location.search).get('id');
const ESPERA_MS = 2500;
const MAXIMO_MS = 4 * 60_000;

const ESTADO_NIVEL = {
  sin_alertas: ['ok', 'ok'],
  con_observaciones: ['na', 'na'],
  revision_recomendada: ['pending', 'revision'],
  atencion_prioritaria: ['alert', 'alerta']
};

function mostrar(seccion) {
  for (const s of ['#progreso', '#fallo', '#resultado']) $(s).hidden = s !== seccion;
}

function mostrarFallo(titulo, texto, acciones) {
  $('#f-titulo').textContent = titulo;
  $('#f-texto').textContent = texto;
  $('#f-acciones').innerHTML = acciones;
  mostrar('#fallo');
}

const accionesFallo = (c, reintentable) => [
  reintentable && `<a class="btn-cta" href="consultar.html?tipo=${c.tipo}${c.placa ? `&placa=${esc(c.placa)}` : ''}"><span>Intentar de nuevo</span></a>`,
  '<a class="btn-secondary" href="panel.html">Ir al panel</a>'
].filter(Boolean).join('');

/** PDF.js muestra el PDF igual en cualquier navegador: muchos celulares no lo hacen solos. */
async function pintarVistaPrevia(ruta) {
  const visor = $('#visor');
  try {
    const blob = await api.pdf(ruta);
    const pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
    visor.textContent = '';
    const escala = Math.min(window.devicePixelRatio || 1, 2) * 1.4;
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      const vista = pagina.getViewport({ scale: escala });
      const lienzo = document.createElement('canvas');
      lienzo.width = vista.width;
      lienzo.height = vista.height;
      lienzo.setAttribute('role', 'img');
      lienzo.setAttribute('aria-label', `Página ${n} de ${doc.numPages} del informe`);
      visor.append(lienzo);
      await pagina.render({ canvas: lienzo, viewport: vista }).promise;
    }
  } catch {
    visor.innerHTML = '<p class="muted cargando">No pudimos mostrar la vista previa, pero puedes descargar el informe.</p>';
  }
}

function mostrarResultado(c) {
  const r = c.resultado;
  const conclusion = r.conclusion;
  const [clase, ic] = ESTADO_NIVEL[conclusion.nivel];

  $('#conclusion').dataset.state = clase;
  $('#c-titulo').innerHTML = `${icono(ic)}${esc(conclusion.titulo)}`;
  const partes = [];
  if (conclusion.aspectosAtencion > 0) partes.push(`<strong>${conclusion.aspectosAtencion} ${conclusion.aspectosAtencion === 1 ? 'aspecto requiere' : 'aspectos requieren'}</strong> atención`);
  if (conclusion.noDisponibles > 0) partes.push(`${conclusion.noDisponibles} ${conclusion.noDisponibles === 1 ? 'verificación no disponible' : 'verificaciones no disponibles'}`);
  $('#c-conteo').innerHTML = partes.join(' · ') || 'Ningún aspecto requiere atención';
  $('#c-texto').textContent = conclusion.descripcion;
  $('#parcial').hidden = !r.parcial;
  $('#vence').textContent = `Código ${r.codigoVerificacion} · Disponible hasta el ${fechaHora(r.venceEn)}`;

  const boton = $('#descargar');
  boton.innerHTML = `${icono('descarga')}<span>Descargar PDF</span>`;
  boton.addEventListener('click', async () => {
    ocupado(boton, true, 'Descargando…');
    try {
      const blob = await api.pdf(r.pdf.descarga);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `informe-${c.placa ?? c.id}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (err) {
      mostrarError($('#vence'), err.message);
    }
    ocupado(boton, false);
  });

  mostrar('#resultado');
  pintarVistaPrevia(r.pdf.vistaPrevia);
}

const inicio = Date.now();
let fuentesListas = false;

while (id) {
  let c;
  try {
    c = await api.consulta(id);
  } catch (err) {
    if (err.status === 404) {
      mostrarFallo('No encontramos ese informe', 'Puede que el enlace esté mal o que pertenezca a otra cuenta.', '<a class="btn-secondary" href="panel.html">Ir al panel</a>');
      break;
    }
    // un fallo de red no cambia la consulta: se sigue intentando
  }

  if (c) {
    if (!fuentesListas) {
      $('#fuentes').innerHTML = TIPOS[c.tipo].fuentes.map((f) => `<li>${esc(f)}</li>`).join('');
      fuentesListas = true;
    }
    if (c.estado === 'completada') {
      mostrarResultado(c);
      break;
    }
    if (c.estado === 'vencida') {
      mostrarFallo(c.error.titulo, c.error.mensaje, accionesFallo(c, true));
      break;
    }
    if (c.estado === 'error') {
      mostrarFallo(c.error.titulo, c.error.mensaje, accionesFallo(c, c.error.reintentable));
      break;
    }
    if (c.estado === 'generando_pdf') {
      $('#p-titulo').textContent = 'Generando tu informe';
      $('#p-texto').textContent = 'Ya tenemos los datos. Estamos armando tu PDF.';
    }
  }

  if (Date.now() - inicio > MAXIMO_MS) {
    mostrarFallo('La consulta está tardando más de lo normal', 'Sigue en proceso: revisa tu panel en unos minutos. Si falla, se devuelve a tu saldo.', '<a class="btn-secondary" href="panel.html">Ir al panel</a>');
    break;
  }
  await new Promise((r) => setTimeout(r, ESPERA_MS));
}

if (!id) mostrarFallo('No encontramos ese informe', 'Falta el identificador de la consulta.', '<a class="btn-secondary" href="panel.html">Ir al panel</a>');
