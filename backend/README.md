# Backend · Carro Sin Rollos

API de la plataforma: usuarios con saldo prepagado, compras con Wompi, consultas a PlacApi, reglas de decisión e informe en PDF (tema oscuro, misma paleta de la web). El PDF se puede ver y descargar durante 7 días.

Node 22+, TypeScript, Express 5, Supabase (base de datos, inicio de sesión y archivos), Playwright (Chromium) para el PDF.

## Arrancar en local

```bash
cd backend
npm install
cp .env.example .env
npm run dev                   # http://localhost:3000
```

Sin configurar nada funciona en modo de desarrollo: PlacApi simulado, datos en memoria y PDF en disco. La sesión es un token `dev-<uuid>`, y `POST /api/dev/compras/:id/aprobar` simula el pago aprobado.

Para el PDF hace falta un Chromium: pon `CHROME_PATH=/usr/bin/google-chrome-stable` en `.env`, o instala el de Playwright con `npx playwright install chromium`.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga automática |
| `npm test` | Pruebas. Las de Supabase se omiten si no hay uno configurado |
| `npm run typecheck` | Revisión de tipos |
| `npm run demo:pdf` | Genera un PDF de ejemplo de cada tipo en `out/` |
| `npm run e2e:web` | Recorre el sitio en un navegador real, contra el backend corriendo |
| `npm run build && npm start` | Compila y arranca como en producción |

## Informes y precios

| Informe | Pide | Fuentes | Créditos de PlacApi |
|---|---|---|---|
| `basico` | Placa | Hurto, pérdida total, prendas | 4 |
| `vin` | VIN | Ficha RUNT por VIN, avalúo, hurto, pérdida total | 5 |
| `full` | Placa + documento del propietario | `/consulta-full`, hurto, pérdida total | 6 |

Lo que un informe no incluye aparece como "No disponible", nunca se omite. Los precios están en `src/precios/catalogo.ts`: son por unidad, el rango depende de la cantidad de cada compra y cada compra sirve para un solo tipo. El saldo no vence.

## API

Todas las rutas, salvo precios, salud y el webhook, exigen `Authorization: Bearer <token de sesión de Supabase>`.

| Método y ruta | Respuesta |
|---|---|
| `GET /api/precios` | Tabla de precios |
| `GET /api/precios/cotizar?tipo=full&cantidad=5` | Total, y `mejorOpcion` si comprar más sale más barato |
| `GET /api/saldo` | Informes disponibles por tipo |
| `POST /api/compras` | Crea la compra y devuelve los datos para abrir el widget de Wompi |
| `GET /api/compras` | Historial de compras |
| `POST /api/webhooks/wompi` | Eventos de Wompi. Valida la firma y acredita una sola vez |
| `POST /api/consultas` | `202` con el `id`. `402` si no hay saldo. `200` si la misma consulta se hizo en las últimas 24 h (no se cobra otra vez) |
| `GET /api/consultas` | Historial del usuario |
| `GET /api/consultas/:id` | Estado. Cuando está `completada`, trae la conclusión y los enlaces del PDF |
| `GET /api/consultas/:id/pdf` | PDF para la vista previa. Con `?descargar=1`, como archivo |
| `GET /api/salud` | `{ ok: true }` |

Cuerpo de `POST /api/consultas`, según el tipo:

```json
{ "tipo": "basico", "placa": "ABC123", "consentimiento": { "aceptado": true, "version": "2026-11" }, "turnstileToken": "..." }
{ "tipo": "vin", "vin": "9GAJC6915FB040270", "consentimiento": { "...": "..." } }
{ "tipo": "full", "placa": "ABC123", "docType": "CC", "docNumber": "1020304050", "consentimiento": { "...": "..." } }
```

Estados: `en_curso` → `generando_pdf` → `completada`, o `error` con un código: `documento_no_coincide`, `sin_resultados`, `fuente_caida`, `servicio_no_disponible`, `error_interno`. Después de 7 días la consulta pasa a `vencida` y el PDF responde `410`.

El frontend debe consultar `GET /api/consultas/:id` cada 2–3 segundos hasta que el estado sea `completada` o `error`. Como el PDF exige sesión, se pide con `fetch` y se muestra como blob.

### Cómo se cobra

1. El saldo se descuenta al crear la consulta.
2. Si la consulta falla, se devuelve una sola vez. También si el servidor se reinicia a mitad: una tarea cada 10 minutos cierra las consultas colgadas.
3. Si solo falla una fuente complementaria, el informe se entrega como `parcial`, consume saldo y esa verificación aparece como "No disponible".

### Modo simulado

Con `PLACAPI_MODO=simulado` no se gastan créditos. Los datos salen de `fixtures/`: la respuesta real anonimizada de RUNT y los ejemplos de la especificación de PlacApi.

| Dato | Resultado |
|---|---|
| Documento `0000000404` | `sin_resultados` |
| Documento `0000000409` | `documento_no_coincide` |
| Documento `0000000502` | `fuente_caida` |
| VIN terminado en `00404` | `sin_resultados` |
| Placa `ALE123` | Hurto activo, pérdida total y prenda |
| Placa `FAL123` | Falla el reporte de hurto: informe parcial |

## Supabase

El esquema está en `supabase/migrations/`: perfiles, compras, saldos, movimientos, consultas y consentimientos, con funciones atómicas para el saldo. Solo el backend toca estas tablas; cada usuario solo puede leer y editar su propio perfil.

Para probar con uno local (requiere Docker):

```bash
npx supabase start
SUPABASE_PRUEBAS_URL=... SUPABASE_PRUEBAS_LLAVE=... SUPABASE_PRUEBAS_ANON=... npm test
```

Para aplicarlo al proyecto real:

```bash
npx supabase link --project-ref <referencia>
npx supabase db push
```

Después hay que poner `SUPABASE_URL` y `SUPABASE_LLAVE_SECRETA`, y en Supabase > Authentication la URL del sitio y el SMTP de Resend.

## Wompi

Se usa el widget: `POST /api/compras` entrega monto, referencia y firma de integridad, y el frontend abre el pago. El saldo se acredita solo cuando llega el evento `transaction.updated` a `POST /api/webhooks/wompi`, con la firma válida y el monto exacto. Esa URL se registra en el dashboard de Wompi.

## Privacidad

- El documento del propietario solo vive en memoria durante la consulta. Se guarda un HMAC (`DOC_HASH_SECRETO`).
- La respuesta cruda de PlacApi no se guarda. La normalización descarta deudores, documentos, noticias criminales y el detalle de multas; un acreedor que parece persona natural se enmascara.
- Cada consulta registra la versión del aviso aceptado, la fecha y un hash de la IP.
- Pendiente de validación legal: plazos de retención y consulta del documento de un tercero.

## Despliegue

`Dockerfile` usa la imagen oficial de Playwright (trae Chromium). La versión de la imagen debe coincidir con `playwright` en `package.json`.

En producción el servidor no arranca sin `DOC_HASH_SECRETO`, `TURNSTILE_SECRETO`, Supabase y las llaves de Wompi.

## Pendiente

- Validar con respuestas reales de PlacApi: solo `/consulta` se probó con datos reales. Lo demás usa los ejemplos de su especificación.
- Si un webhook de Wompi se pierde después de sus 3 reintentos, hoy no hay conciliación automática.
- Caché por fuente entre usuarios y registro de créditos reales gastados.
- Correos propios (recibo de compra, informe listo) y facturación electrónica. Los de registro y recuperación están en `supabase/templates/`.
- Confirmar el plazo de la primera revisión técnico-mecánica (`src/reglas/runt.ts`).
