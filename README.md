# Carro Sin Rollos

Herramienta para decidir si comprar un vehículo usado en Colombia: a partir de la placa, revisa la información disponible y le dice al comprador qué debe revisar antes de comprar.

## Estructura

| Carpeta | Qué contiene |
|---|---|
| `frontend/` | Sitio que va a producción (HTML/CSS/JS plano). Es la carpeta que publica Cloudflare Pages. |
| `backend/` | API (Node/Express + PostgreSQL vía Supabase). Pendiente de construir. |
| `docs/` | Documentos de referencia: cobertura y créditos de PlacApi, paleta de color, logo original. |
| `mocks/` | Mocks y plantillas que no van a producción: estructura de páginas y la landing de la encuesta. |

## Frontend

```
frontend/
├── index.html          landing principal
├── css/main_stylesheet.css
├── js/landing.js
└── img/                recortes del logo corporativo
```

Para verlo en local basta con abrir `frontend/index.html` en el navegador, o servir la carpeta:

```
npx serve frontend
```

### Cloudflare Pages

En la configuración del proyecto, el directorio de salida (*Build output directory*) debe ser `frontend`. Sin comando de build.
