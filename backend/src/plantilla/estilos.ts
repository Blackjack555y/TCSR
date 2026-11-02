// CSS del informe en PDF (A4). Mismos tokens que frontend/css/main_stylesheet.css.
// Los estados nunca dependen solo del color: siempre llevan ícono + texto.

const cadenaCss = (s: string) => `"${s.replace(/["\\]/g, '')}"`;

export function estilos(p: { placa: string; codigo: string; fecha: string }): string {
  return `
:root {
  --bg-0: #131516; --bg-1: #1b1e20; --bg-2: #23272a; --line: #33383b;
  --text-1: #f3f4f4; --text-2: #a9afb2;
  --green-1: #2fe6a6; --green-2: #12a5a0; --orange: #f0a83c;
  --ok: #2fe6a6; --ok-bg: rgba(47,230,166,.10);
  --pending: #f0a83c; --pending-bg: rgba(240,168,60,.12);
  --na: #8a8f93; --na-text: #b4b9bc; --na-bg: rgba(138,143,147,.14);
  --alert: #e5484d; --alert-text: #ff6b6f; --alert-bg: rgba(229,72,77,.12);
  --plate-yellow: #f6c90e; --plate-ink: #111;
  --radius: 14px;
}

/* El fondo oscuro cubre toda la hoja, incluidos los márgenes. */
@page {
  size: A4;
  margin: 18mm 14mm 18mm;
  background: #131516;
  @top-left { content: ${cadenaCss(`Carro Sin Rollos · Informe ${p.placa}`)}; color: #a9afb2; font: 500 7.5pt 'Inter', sans-serif; }
  @top-right { content: ${cadenaCss(p.fecha)}; color: #a9afb2; font: 500 7.5pt 'Inter', sans-serif; }
  @bottom-left { content: ${cadenaCss(`Código de verificación ${p.codigo}`)}; color: #a9afb2; font: 500 7.5pt 'Inter', sans-serif; }
  @bottom-right { content: "Página " counter(page) " de " counter(pages); color: #a9afb2; font: 500 7.5pt 'Inter', sans-serif; }
}
@page :first {
  @top-left { content: none; }
  @top-right { content: none; }
}

* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; background: var(--bg-0); color: var(--text-1); }
body { font-family: 'Inter', sans-serif; font-size: 9.5pt; line-height: 1.5; }
h1, h2, h3 { font-family: 'Sora', sans-serif; margin: 0; line-height: 1.25; }
p { margin: 0; }
.muted { color: var(--text-2); }

.ico { width: 1.15em; height: 1.15em; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

/* encabezado */
.top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 8px; }
.brand-icon { height: 30px; }
.brand-name { height: 12px; }
.top-meta { display: flex; flex-direction: column; align-items: flex-end; color: var(--text-2); font-size: 8pt; }
.doc-type { font-family: 'Sora', sans-serif; font-weight: 700; color: var(--text-1); font-size: 9pt; }

.vehicle { display: flex; align-items: center; gap: 12px; margin: 16px 0 12px; }
.plate {
  background: var(--plate-yellow); color: var(--plate-ink);
  border: 2px solid var(--plate-ink); border-radius: 6px;
  font-family: 'Sora', sans-serif; font-weight: 800; font-size: 13pt; letter-spacing: .1em;
  padding: 2px 12px;
}
.vehicle-desc { color: var(--text-2); font-size: 10pt; }

/* conclusión */
.conclusion {
  background: var(--bg-1); border: 1px solid var(--line); border-left: 5px solid var(--c);
  border-radius: var(--radius); padding: 16px 18px; break-inside: avoid;
}
.conclusion.ok { --c: var(--ok); } .conclusion.pending { --c: var(--pending); }
.conclusion.na { --c: var(--na); } .conclusion.alert { --c: var(--alert); }
.conclusion.alert .conclusion-title { color: var(--alert-text); }
.conclusion.na .conclusion-title { color: var(--na-text); }
.kicker { color: var(--text-2); font-size: 7.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; }
.conclusion-title { display: flex; align-items: center; gap: 8px; font-family: 'Sora', sans-serif; font-weight: 800; font-size: 17pt; color: var(--c); margin: 4px 0 2px; }
.conclusion-count { font-size: 10pt; margin-bottom: 6px; }
.conclusion-desc { color: var(--text-2); }

/* bloques */
.block { margin-top: 20px; }
.block h2 { font-size: 11.5pt; font-weight: 700; margin-bottom: 10px; break-after: avoid; }
.keep { break-inside: avoid; }

.chips { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.chip {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  background: var(--bg-1); border: 1px solid var(--line); border-radius: 10px;
  padding: 8px 10px; break-inside: avoid;
}
.chip-text { display: flex; flex-direction: column; min-width: 0; }
.chip-name { font-weight: 600; }
.chip-detail { color: var(--text-2); font-size: 8pt; }

.state {
  display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
  padding: 2px 8px; border-radius: 999px; border: 1px solid transparent;
  font-size: 7pt; font-weight: 700; letter-spacing: .03em; text-transform: uppercase;
}
.state .ico { width: 10px; height: 10px; stroke-width: 2.4; }
.state.ok { background: var(--ok-bg); color: var(--ok); }
.state.pending { background: var(--pending-bg); color: var(--pending); border-color: rgba(240,168,60,.35); }
.state.na { background: var(--na-bg); color: var(--na-text); border-style: dashed; border-color: var(--na); }
.state.alert { background: var(--alert-bg); color: var(--alert-text); border-color: rgba(229,72,77,.45); }

.note { display: flex; gap: 6px; align-items: flex-start; color: var(--text-2); font-size: 8pt; margin-top: 8px; }
.note .ico { color: var(--na); margin-top: 1px; }
.note strong { color: var(--text-1); }

/* hallazgos */
.finding {
  background: var(--bg-1); border: 1px solid var(--line); border-left: 4px solid var(--c);
  border-radius: var(--radius); padding: 12px 16px; margin-bottom: 10px; break-inside: avoid;
}
.finding.pending { --c: var(--pending); } .finding.alert { --c: var(--alert); }
.finding-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.finding-num { color: var(--text-2); font-size: 7.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
.finding h3 { font-size: 11pt; margin-bottom: 8px; }
.finding dl { margin: 0; display: grid; gap: 6px; }
.finding dt { font-family: 'Sora', sans-serif; font-weight: 700; font-size: 8pt; }
.finding dd { margin: 0; color: var(--text-2); }
.finding-source { color: var(--text-2); font-size: 7.5pt; margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line); }

.steps { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.steps li::marker { color: var(--green-1); font-family: 'Sora', sans-serif; font-weight: 700; }

/* ¿Qué significa este informe? — destacado */
.meaning {
  background: var(--bg-1); border: 1px solid var(--green-2); border-radius: var(--radius); padding: 14px 18px;
}
.meaning h2 { color: var(--green-1); }
.meaning p { color: var(--text-2); font-size: 8.5pt; margin-bottom: 5px; }
.meaning p:last-child { margin-bottom: 0; }

/* evidencia */
.evidence { break-before: page; }
.ev-title { font-size: 9.5pt; margin: 14px 0 6px; break-after: avoid; }
table { width: 100%; border-collapse: collapse; font-size: 8pt; break-inside: auto; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th { background: var(--bg-2); color: var(--text-2); font-family: 'Sora', sans-serif; font-weight: 700; font-size: 7.5pt; }
tr { break-inside: avoid; }
.ficha th { width: 34%; color: var(--text-2); font-weight: 500; }
.ficha td { font-weight: 600; font-variant-numeric: tabular-nums; }
.t-ok { color: var(--ok); }

.end { margin-top: 22px; padding-top: 10px; border-top: 1px solid var(--line); color: var(--text-2); font-size: 8pt; display: grid; gap: 2px; break-inside: avoid; }
.end strong { color: var(--text-1); }
`;
}
