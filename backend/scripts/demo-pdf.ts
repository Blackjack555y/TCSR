// Genera un PDF de ejemplo por cada tipo de informe, con la fuente simulada.
// Uso: npm run demo:pdf   (con CHROME_PATH si no instalaste el Chromium de Playwright)

import { mkdir, writeFile } from 'node:fs/promises';
import { obtenerDatos, type EntradaInforme } from '../src/consultas/orquestador.js';
import { armarInforme } from '../src/informe/armar.js';
import { RenderizadorPdf } from '../src/pdf/render.js';
import { FuenteSimulada } from '../src/placapi/simulado.js';
import { renderInformeHtml } from '../src/plantilla/informe-html.js';

const ejemplos: [string, EntradaInforme][] = [
  ['basico', { tipo: 'basico', placa: 'ABC12D' }],
  ['vin', { tipo: 'vin', vin: '9FLA37CZ0EA000001' }],
  ['full', { tipo: 'full', placa: 'ABC123', docType: 'CC', docNumber: '1020304050' }],
  ['full-alertas', { tipo: 'full', placa: 'ALE123', docType: 'CC', docNumber: '1020304050' }]
];

const ahora = new Date('2026-10-08T15:00:00Z');
const fuente = new FuenteSimulada(0);
const pdf = new RenderizadorPdf(process.env.CHROME_PATH);
await mkdir('out', { recursive: true });

for (const [nombre, entrada] of ejemplos) {
  const informe = armarInforme(await obtenerDatos(fuente, entrada), { ahora, diasVigencia: 7 });
  await writeFile(`out/informe-${nombre}.pdf`, await pdf.renderizar(renderInformeHtml(informe)));
  console.log(`out/informe-${nombre}.pdf · ${informe.conclusion.titulo} · ${informe.hallazgos.length} hallazgos`);
}
await pdf.cerrar();
