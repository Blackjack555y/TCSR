import type { EstadoConsulta, Hallazgo, Informe, Nivel, NivelGeneral, TipoInforme, Verificacion, Vigencia } from '../dominio/tipos.js';
import { fechaCorta, hoyColombia } from '../reglas/fechas.js';
import { cssFuentes, logosDataUri } from './assets.js';
import { estilos } from './estilos.js';

// Plantilla del informe en PDF. Mismo esquema de color que la web.
// Orden: decisión primero (conclusión, resumen, hallazgos, pasos), evidencia al final.

const esc = (s: string | number | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Íconos de línea, los mismos de la landing.
const ICONOS = {
  ok: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  revision: '<circle cx="12" cy="12" r="10"/><path d="M12 7v6"/><path d="M12 17h.01"/>',
  na: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
  alerta: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'
};
const icono = (k: keyof typeof ICONOS) =>
  `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONOS[k]}</svg>`;

const ESTADO: Record<Nivel, { clase: string; texto: string; icono: keyof typeof ICONOS }> = {
  sin_hallazgos: { clase: 'ok', texto: 'Sin hallazgos', icono: 'ok' },
  revision: { clase: 'pending', texto: 'Requiere revisión', icono: 'revision' },
  no_disponible: { clase: 'na', texto: 'No disponible', icono: 'na' },
  alerta: { clase: 'alert', texto: 'Alerta', icono: 'alerta' }
};

const GENERAL: Record<NivelGeneral, { clase: string; icono: keyof typeof ICONOS }> = {
  sin_alertas: { clase: 'ok', icono: 'ok' },
  con_observaciones: { clase: 'na', icono: 'na' },
  revision_recomendada: { clase: 'pending', icono: 'revision' },
  atencion_prioritaria: { clase: 'alert', icono: 'alerta' }
};

const MOTIVO_NO_DISPONIBLE: Record<EstadoConsulta, string> = {
  ok: '',
  error: 'La fuente no respondió',
  no_consultada: 'No incluido en este tipo de informe',
  no_cubierta: 'La fuente no publica este dato'
};

const NOMBRE_INFORME: Record<TipoInforme, string> = { basico: 'Informe Básico', vin: 'Informe por VIN', full: 'Informe Full' };

const estado = (n: Nivel) => {
  const e = ESTADO[n];
  return `<span class="state ${e.clase}">${icono(e.icono)}${e.texto}</span>`;
};

const fechaHora = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));

const fechaLarga = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long' }).format(new Date(iso));

// ---------------------------------------------------------------------------

function chip(v: Verificacion): string {
  const detalle = v.nivel === 'no_disponible' ? v.valor ?? MOTIVO_NO_DISPONIBLE[v.consulta] : v.valor;
  return `<li class="chip">
    <div class="chip-text"><span class="chip-name">${esc(v.nombre)}</span>${detalle ? `<span class="chip-detail">${esc(detalle)}</span>` : ''}</div>
    ${estado(v.nivel)}
  </li>`;
}

function hallazgo(h: Hallazgo, i: number): string {
  const consultado = h.consultadoEn ? fechaCorta(h.consultadoEn.slice(0, 10)) : '—';
  return `<article class="finding ${ESTADO[h.nivel].clase}">
    <header class="finding-head">
      <span class="finding-num">Hallazgo ${String(i + 1).padStart(2, '0')}</span>
      ${estado(h.nivel)}
    </header>
    <h3>${esc(h.titulo)}</h3>
    <dl>
      <div><dt>Qué encontramos</dt><dd>${esc(h.queEncontramos)}</dd></div>
      <div><dt>Qué significa</dt><dd>${esc(h.queSignifica)}</dd></div>
      <div><dt>Qué hacer</dt><dd>${esc(h.queHacer)}</dd></div>
    </dl>
    <p class="finding-source">Fuente: ${esc(h.fuente)} · Consultado el ${consultado}</p>
  </article>`;
}

function tablaVigencias(titulo: string, filas: Vigencia[], hoy: string, columnaEntidad: string): string {
  if (filas.length === 0) return `<h3 class="ev-title">${titulo}</h3><p class="muted">Sin registros en la fuente.</p>`;
  return `<h3 class="ev-title">${titulo}</h3>
  <table>
    <thead><tr><th>Desde</th><th>Hasta</th><th>${columnaEntidad}</th><th>Estado</th></tr></thead>
    <tbody>${filas.map((f) => {
      const vigente = !!f.desde && !!f.hasta && f.desde <= hoy && hoy <= f.hasta;
      return `<tr><td>${fechaCorta(f.desde)}</td><td>${fechaCorta(f.hasta)}</td><td>${esc(f.entidad ?? '—')}</td><td>${vigente ? '<strong class="t-ok">Vigente</strong>' : 'No vigente'}</td></tr>`;
    }).join('')}</tbody>
  </table>`;
}

function tabla(titulo: string, columnas: string[], filas: string[][]): string {
  return `<h3 class="ev-title">${esc(titulo)}</h3>
  <table>
    <thead><tr>${columnas.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${filas.map((f) => `<tr>${f.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
}

// ---------------------------------------------------------------------------

export function renderInformeHtml(inf: Informe): string {
  const logos = logosDataUri();
  const c = inf.conclusion;
  const g = GENERAL[c.nivel];
  const hoy = hoyColombia(new Date(inf.generadoEn));
  const consultaFecha = fechaHora(inf.generadoEn);

  const lineaConteo = [
    c.aspectosAtencion > 0 && `<strong>${c.aspectosAtencion} ${c.aspectosAtencion === 1 ? 'aspecto requiere' : 'aspectos requieren'}</strong> atención`,
    c.noDisponibles > 0 && `${c.noDisponibles} ${c.noDisponibles === 1 ? 'verificación no disponible' : 'verificaciones no disponibles'}`
  ].filter(Boolean).join(' · ') || 'Ningún aspecto requiere atención';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Informe ${esc(inf.vehiculo.placa)} · Carro Sin Rollos</title>
<style>
${cssFuentes()}
${estilos({ placa: inf.vehiculo.placa || NOMBRE_INFORME[inf.tipo], codigo: inf.codigoVerificacion, fecha: fechaLarga(inf.generadoEn) })}
</style>
</head>
<body>

<header class="top">
  <div class="brand"><img class="brand-icon" src="${logos.icono}" alt=""><img class="brand-name" src="${logos.nombre}" alt="Carro Sin Rollos"></div>
  <div class="top-meta">
    <span class="doc-type">${NOMBRE_INFORME[inf.tipo]}</span>
    <span>${esc(consultaFecha)}</span>
  </div>
</header>

<section class="vehicle">
  ${inf.vehiculo.placa ? `<span class="plate">${esc(inf.vehiculo.placa)}</span>` : ''}
  <span class="vehicle-desc">${esc(inf.vehiculo.descripcion)}</span>
</section>

${inf.parcial ? `<p class="partial">${icono('na')}<span><strong>Informe parcial.</strong> Una o más fuentes no respondieron: esas verificaciones aparecen como "No disponible".</span></p>` : ''}

<section class="conclusion ${g.clase}">
  <p class="kicker">Resultado de la revisión</p>
  <p class="conclusion-title">${icono(g.icono)}${esc(c.titulo)}</p>
  <p class="conclusion-count">${lineaConteo}</p>
  <p class="conclusion-desc">${esc(c.descripcion)}</p>
</section>

<section class="block">
  <h2>Resumen de verificaciones</h2>
  <ul class="chips">${inf.verificaciones.map(chip).join('')}</ul>
  <p class="note">${icono('na')}<span><strong>No disponible</strong> significa que no tuvimos acceso a ese dato. No significa que no exista un problema.</span></p>
</section>

${inf.hallazgos.length > 0 ? `<section class="block">
  <h2>Hallazgos que requieren atención</h2>
  ${inf.hallazgos.map(hallazgo).join('')}
</section>` : ''}

<section class="block keep">
  <h2>Próximos pasos</h2>
  <ol class="steps">${inf.proximosPasos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
</section>

<section class="block meaning keep">
  <h2>¿Qué significa este informe?</h2>
  ${inf.metodologia.map((m) => `<p>${esc(m)}</p>`).join('')}
</section>

<section class="block evidence">
  <h2>Evidencia y datos consultados</h2>
  <h3 class="ev-title">Ficha del vehículo (RUNT)</h3>
  <table class="ficha"><tbody>${inf.vehiculo.ficha.map((f) => `<tr><th>${esc(f.etiqueta)}</th><td>${esc(f.valor)}</td></tr>`).join('')}</tbody></table>
  ${inf.tipo === 'basico' ? '' : tablaVigencias('Historial de SOAT', inf.evidencia.soat, hoy, 'Aseguradora')}
  ${inf.tipo === 'basico' ? '' : tablaVigencias('Historial de revisión técnico-mecánica', inf.evidencia.rtm, hoy, 'CDA')}
  ${inf.evidencia.traspasos.length > 0 ? `<h3 class="ev-title">Traspasos registrados</h3><p class="muted">${inf.evidencia.traspasos.map(fechaCorta).join(' · ')}</p>` : ''}
  ${inf.evidencia.siniestros.length > 0 ? tabla('Reclamaciones a aseguradoras', ['Fecha', 'Amparo', 'Severidad'], inf.evidencia.siniestros.map((r) => [fechaCorta(r.fecha), r.amparo ?? '—', r.severidad ?? '—'])) : ''}
  ${(inf.evidencia.accidentes ?? []).length > 0 ? tabla('Accidentes en Bogotá', ['Fecha', 'Gravedad'], inf.evidencia.accidentes.map((r) => [fechaCorta(r.fecha), r.gravedad ?? '—'])) : ''}
  ${inf.evidencia.hurto.length > 0 ? tabla('Registros judiciales de la placa', ['Fecha', 'Categoría', 'Estado'], inf.evidencia.hurto.map((r) => [fechaCorta(r.fecha), r.categoria ?? '—', r.estado ?? '—'])) : ''}
</section>

<footer class="end">
  <p><strong>Código de verificación:</strong> ${esc(inf.codigoVerificacion)}</p>
  <p>Generado el ${esc(consultaFecha)} · Disponible para descarga hasta el ${esc(fechaLarga(inf.venceEn))}</p>
  <p class="muted">Reglas ${esc(inf.versiones.reglas)} · Plantilla ${esc(inf.versiones.plantilla)} · Carro Sin Rollos no es el RUNT ni una entidad oficial.</p>
</footer>

</body>
</html>`;
}
