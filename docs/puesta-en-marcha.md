# Puesta en marcha de Carro Sin Rollos

Pasos para pasar de lo que está en el repositorio a la plataforma en producción. Cada paso dice qué cuenta necesita y dónde va cada dato. Nunca pegues llaves secretas en el código ni en chats: van en las variables de entorno del hosting.

## Antes de empezar

- [ ] Abogado: aviso de privacidad, términos, consulta de la cédula de un tercero, plazos de retención y transferencia internacional de datos (la base de datos y el backend quedan en Estados Unidos). Los textos de `frontend/privacidad.html` y `frontend/terminos.html` son borradores con datos entre corchetes: no se publican así.
- [ ] Contador: si se factura electrónicamente, si la tarifa de IVA es 19 % y qué datos del cliente exige la factura.
- [ ] Correo del negocio para abrir todas las cuentas, con verificación en dos pasos.

## 1. GitHub

1. Crear un repositorio privado y subir el código.
2. Unir la rama `backend-informes` a `main`.

## 2. Supabase

1. Crear el proyecto en East US (Ohio, `us-east-2`), la misma región del backend en Render. Lo que importa es la distancia entre el backend y la base: Render no tiene servidores en Sudamérica.
2. Aplicar el esquema:
   ```bash
   cd backend
   npx supabase link --project-ref <referencia>
   npx supabase db push
   ```
3. En Authentication > URL Configuration: poner la URL del sitio y agregar `https://sudominio.com/nueva-clave.html` y `https://sudominio.com/ingresar.html` a las URLs de redirección.
4. En Authentication > Email Templates: copiar `backend/supabase/templates/` (confirmación y recuperación).
5. Activar "Confirm email" y poner la contraseña mínima en 8 caracteres.
6. Pasar a plan Pro antes de lanzar: el gratuito se pausa sin uso y no tiene respaldos diarios.

Guarda: URL del proyecto, llave pública (anon) y llave secreta (service role).

## 3. Resend (correos)

1. Crear la cuenta y agregar el dominio.
2. Poner en Cloudflare los registros DNS que indique Resend.
3. En Supabase > Authentication > SMTP: conectar Resend. Sin esto, Supabase solo envía unos pocos correos por hora.

## 4. Cloudflare Turnstile (pendiente: se lanza sin él)

El backend arranca sin Turnstile y lo advierte en el registro. Mientras tanto, lo que frena el abuso es el saldo pagado y el límite de 5 consultas fallidas por usuario al día.

Para activarlo:
1. Crear un widget para el dominio. Guarda la llave del sitio (pública) y la llave secreta.
2. Poner **las dos a la vez**: `TURNSTILE_SECRETO` en Render y `TURNSTILE_LLAVE_SITIO` en `frontend/js/config.js`. Si el backend tiene el secreto y el sitio no tiene la llave, todas las consultas se rechazan.
3. Opcional: activarlo también para registro e inicio de sesión en Supabase > Authentication > Bot and Abuse Protection (exige agregar el widget en esas páginas).

## 5. PlacApi

1. Generar la API key en `placapi.com/integracion`.
2. Comprar créditos.
3. Probar en local con `PLACAPI_MODO=real` y los tres informes: **hoy solo `/consulta` se ha probado con datos reales**. Revisar los PDF antes de lanzar.

## 6. Wompi

1. Abrir la cuenta de comercio (RUT, datos del negocio, cuenta bancaria).
2. En Desarrolladores, tomar las llaves de prueba (`pub_test_` y `prv_test_`), el secreto de integridad y el secreto de eventos.
3. Registrar la URL de eventos: `https://<backend>/api/webhooks/wompi`.
4. Hacer una compra completa con las tarjetas de prueba. Probar también cerrar el widget a mitad del pago: la compra debe confirmarse sola. Después cambiar a llaves de producción.

## 7. Render (backend)

1. Crear el servicio desde el repositorio con `render.yaml`. Plan con al menos 1 GB de memoria: el PDF usa Chromium.
2. Completar las variables:

| Variable | Valor |
|---|---|
| `PLACAPI_KEY` | API key de PlacApi |
| `CORS_ORIGENES` | `https://sudominio.com` |
| `TURNSTILE_SECRETO` | Llave secreta de Turnstile |
| `SUPABASE_URL` | URL del proyecto |
| `SUPABASE_LLAVE_SECRETA` | Llave service role |
| `WOMPI_LLAVE_PUBLICA` | `pub_test_...` o `pub_prod_...` |
| `WOMPI_SECRETO_INTEGRIDAD` | Secreto de integridad |
| `WOMPI_SECRETO_EVENTOS` | Secreto de eventos |
| `WOMPI_LLAVE_PRIVADA` | `prv_test_...` o `prv_prod_...`: confirma pagos si el webhook no llega |
| `WOMPI_URL_REDIRECCION` | `https://sudominio.com/compra-resultado.html` |
| `RESEND_LLAVE` | Llave de Resend, para los correos de compra e informe |
| `CORREO_REMITENTE` | `Carro Sin Rollos <no-responder@sudominio.com>` |
| `SITIO_URL` | `https://sudominio.com` |
| `LIMITE_FALLIDAS_DIA` | `5` (consultas fallidas por datos por usuario al día) |
| `ALERTA_CREDITOS_DIA` | Créditos de PlacApi por día que disparan una alerta. Ponlo cerca del doble de lo esperado |

`DOC_HASH_SECRETO` lo genera Render. **No lo cambies después:** dejaría de reconocer consultas repetidas.

El servidor no arranca si falta alguna variable obligatoria: el error dice cuál.

## 8. Cloudflare Pages (frontend)

1. Editar `frontend/js/config.js`:
   ```js
   API_URL: 'https://<backend>',
   SUPABASE_URL: 'https://xxxx.supabase.co',
   SUPABASE_LLAVE_PUBLICA: '<llave anon>',
   TURNSTILE_LLAVE_SITIO: '<llave del sitio>'
   ```
2. Conectar el repositorio, con `frontend` como directorio de salida y sin comando de build.
3. Decidir qué pasa con la encuesta: está en `mocks/encuesta/` y deja de estar en línea.

## 9. Antes de abrir al público

- [ ] Compra real de bajo valor, con factura si aplica.
- [ ] Probar en un celular real: compra, consulta, vista previa y descarga.
- [ ] Reemplazar los recortes del logo por los SVG del diseñador.
- [ ] Sentry y UptimeRobot.
