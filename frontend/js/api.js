// Cliente del backend. La sesión viaja en el encabezado Authorization.

import { CONFIG } from './config.js';
import { tokenActual } from './sesion.js';

export class ErrorApi extends Error {
  constructor(status, codigo, mensaje, datos) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    this.datos = datos;
  }
}

async function peticion(ruta, opciones = {}) {
  const token = await tokenActual();
  let res;
  try {
    res = await fetch(`${CONFIG.API_URL}${ruta}`, {
      ...opciones,
      headers: {
        ...(opciones.body && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` })
      }
    });
  } catch {
    throw new ErrorApi(0, 'sin_conexion', 'No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.');
  }
  if (res.ok) return res;

  const cuerpo = await res.json().catch(() => null);
  const e = cuerpo?.error;
  throw new ErrorApi(res.status, e?.codigo ?? 'error', e?.mensaje ?? 'Algo falló. Intenta de nuevo.', e);
}

const json = async (ruta, opciones) => (await peticion(ruta, opciones)).json();
const post = (ruta, datos) => json(ruta, { method: 'POST', body: JSON.stringify(datos ?? {}) });

export const api = {
  precios: () => json('/api/precios'),
  cotizar: (tipo, cantidad) => json(`/api/precios/cotizar?tipo=${tipo}&cantidad=${cantidad}`),
  saldo: () => json('/api/saldo'),
  compras: () => json('/api/compras'),
  crearCompra: (tipo, cantidad) => post('/api/compras', { tipo, cantidad }),
  aprobarCompraDesarrollo: (id) => post(`/api/dev/compras/${id}/aprobar`),
  consultas: () => json('/api/consultas'),
  consulta: (id) => json(`/api/consultas/${id}`),
  crearConsulta: (datos) => post('/api/consultas', datos),
  /** Descarga el PDF con la sesión del usuario. */
  pdf: async (ruta) => (await peticion(ruta)).blob()
};
