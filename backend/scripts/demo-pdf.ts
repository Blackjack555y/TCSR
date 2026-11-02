// Genera el PDF de ejemplo con la respuesta guardada, sin servidor ni créditos.
// Uso: npm run demo:pdf   (con CHROME_PATH si no instalaste el Chromium de Playwright)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { armarInforme } from '../src/informe/armar.js';
import { normalizarRunt } from '../src/normalizacion/runt.js';
import { RenderizadorPdf } from '../src/pdf/render.js';
import type { RawConsultaRunt } from '../src/placapi/tipos.js';
import { renderInformeHtml } from '../src/plantilla/informe-html.js';

const raw = JSON.parse(await readFile(new URL('../fixtures/runt-consulta-abc12d.json', import.meta.url), 'utf8')) as RawConsultaRunt;
const ahora = process.argv[2] ? new Date(process.argv[2]) : new Date('2026-10-08T15:00:00Z');

const informe = armarInforme(normalizarRunt(raw), { ahora, consultadoEn: raw.fetchedAt ?? null, diasVigencia: 7 });
const html = renderInformeHtml(informe);

await mkdir('out', { recursive: true });
await writeFile('out/informe-ejemplo.html', html);
await writeFile('out/informe-ejemplo.json', JSON.stringify(informe, null, 2));

const pdf = new RenderizadorPdf(process.env.CHROME_PATH);
const t = performance.now();
await writeFile('out/informe-ejemplo.pdf', await pdf.renderizar(html));
console.log(`PDF generado en ${Math.round(performance.now() - t)} ms → out/informe-ejemplo.pdf`);
await pdf.cerrar();
