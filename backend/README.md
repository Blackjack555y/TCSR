# Backend · Carro Sin Rollos

API que consulta un vehículo en PlacApi, aplica las reglas de decisión y entrega el informe en PDF (tema oscuro, misma paleta de la web). El PDF se puede ver y descargar durante 7 días.

Node 22+, TypeScript, Express 5, Playwright (Chromium) para el PDF.

## Arrancar en local

```bash
cd backend
npm install
cp .env.example .env          # en modo "simulado" no hace falta API key
npm run dev                   # http://localhost:3000
```

Para el PDF hace falta un Chromium: pon `CHROME_PATH=/usr/bin/google-chrome-stable` en `.env`, o instala el de Playwright con `npx playwright install chromium`.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga automática |
| `npm test` | Pruebas (reglas, informe y API) |
| `npm run typecheck` | Revisión de tipos |
| `npm run demo:pdf` | Genera `out/informe-ejemplo.pdf` con la respuesta guardada, sin servidor |
| `npm run build && npm start` | Compila y arranca como en producción |

## API

| Método y ruta | Respuesta |
|---|---|
| `POST /api/consultas` | `202` con `{ id, estado: "en_curso" }`. Si la misma placa y documento se consultaron en las últimas 24 h, `200` con esa consulta (no se paga dos veces). |
| `GET /api/consultas/:id` | Estado de la consulta. Cuando está `completada`, trae la conclusión y los enlaces del PDF. |
| `GET /api/consultas/:id/pdf` | El PDF para la vista previa (`inline`). |
| `GET /api/consultas/:id/pdf?descargar=1` | El PDF como archivo descargable. |
| `GET /api/salud` | `{ ok: true }` |

Cuerpo de `POST /api/consultas`:

```json
{
  "placa": "ABC123",
  "docType": "CC",
  "docNumber": "1020304050",
  "consentimiento": { "aceptado": true, "version": "2026-10" },
  "turnstileToken": "..."
}
```

Estados: `en_curso` → `generando_pdf` → `completada`, o `error` con un código:
`documento_no_coincide`, `sin_resultados`, `fuente_caida`, `servicio_no_disponible`, `error_interno`.
Después de 7 días la consulta pasa a `vencida` y el PDF responde `410`.

El frontend debe consultar `GET /api/consultas/:id` cada 2–3 segundos hasta que el estado sea `completada` o `error`.

### Modo simulado

Con `PLACAPI_MODO=simulado` cualquier placa devuelve la moto de ejemplo (`fixtures/`, respuesta real anonimizada). Estos documentos simulan errores:

| Documento | Resultado |
|---|---|
| `0000000404` | `sin_resultados` |
| `0000000409` | `documento_no_coincide` |
| `0000000502` | `fuente_caida` |

## Estructura

```
src/
├── api/            rutas, validación (zod), Turnstile, límites de peticiones
├── consultas/      proceso de la consulta, estados y repositorio
├── placapi/        cliente real, fuente simulada y traducción de errores
├── normalizacion/  respuesta cruda → modelo propio (aquí se descarta la cédula)
├── reglas/         funciones puras: vehículo + fecha → verificaciones y hallazgos
├── informe/        conclusión, próximos pasos, metodología
├── plantilla/      HTML + CSS del PDF (A4, fuentes y logo incrustados)
├── pdf/            render con Chromium (un navegador compartido)
├── almacenamiento/ dónde se guardan los PDF
└── privacidad/     hash del documento y de la IP
```

## Privacidad

- El documento del propietario solo vive en memoria mientras se hace la consulta. Se guarda un HMAC (`DOC_HASH_SECRETO`) para reconocer consultas repetidas.
- La respuesta cruda de PlacApi no se guarda. El informe solo contiene datos del vehículo.
- Cada consulta registra la versión del aviso de privacidad aceptado, la fecha y un hash de la IP.
- Pendiente de validación legal: plazos de retención y consulta del documento de un tercero.

## Despliegue

`Dockerfile` usa la imagen oficial de Playwright (trae Chromium). Sirve igual para Railway o Render. La versión de la imagen debe coincidir con `playwright` en `package.json`.

En producción son obligatorias `DOC_HASH_SECRETO` y `TURNSTILE_SECRETO`: el servidor no arranca sin ellas.

## Pendiente

- Supabase: repositorio y almacenamiento (hoy en memoria y en disco). El esquema está en `db/migraciones/001_consultas.sql`.
- `/consulta-full`, reporte de hurto y pérdida total (MVP2): falta una respuesta real de `/consulta-full` para escribir su normalizador.
- Confirmar el plazo de la primera revisión técnico-mecánica (`src/reglas/runt.ts`).
