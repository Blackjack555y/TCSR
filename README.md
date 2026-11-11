# Carro Sin Rollos

Herramienta para decidir si comprar un vehículo usado en Colombia: a partir de la placa, revisa la información disponible y le dice al comprador qué debe revisar antes de comprar.

## Estructura

| Carpeta | Qué contiene |
|---|---|
| `frontend/` | Sitio que va a producción (HTML/CSS/JS plano). Es la carpeta que publica Cloudflare Pages. |
| `backend/` | API (Node/Express + Supabase): usuarios, saldo, compras con Wompi, consultas a PlacApi e informe en PDF. Ver `backend/README.md`. |
| `docs/` | Documentos de referencia: cobertura y créditos de PlacApi, paleta de color, logo original. |
| `mocks/` | Mocks y plantillas que no van a producción: estructura de páginas y la landing de la encuesta. |

## Frontend

HTML, CSS y JavaScript plano, sin build.

| Página | Para qué |
|---|---|
| `index.html` | Landing |
| `registro`, `ingresar`, `recuperar`, `nueva-clave` | Cuenta |
| `comprar`, `compra-resultado` | Compra con Wompi |
| `panel`, `cuenta` | Saldo, historial y datos del cliente |
| `consultar`, `informe` | Consulta, vista previa y descarga del PDF |
| `privacidad`, `terminos`, `404` | Textos legales (borradores) y error |

`js/config.js` tiene la configuración pública. Sin Supabase configurado, el sitio funciona en modo de desarrollo, con cuentas de prueba y pagos simulados.

## Probarlo en local

```bash
cd backend && npm install && CHROME_PATH=/usr/bin/google-chrome-stable npm run dev   # API en :3000
python3 -m http.server 5173 -d frontend                                              # sitio en :5173
```

Abre http://localhost:5173. Con los dos corriendo, `npm run e2e:web` (detén el servidor del puerto 5173) recorre todo el sitio en un navegador real.

Para ponerlo en producción: `docs/puesta-en-marcha.md`.
