// Configuración pública del sitio. Aquí NO van secretos: la llave pública de Supabase
// y la de Turnstile están hechas para ir en el navegador.
// Sin SUPABASE_URL el sitio funciona en modo de desarrollo (cuentas de prueba locales
// y pagos simulados), siempre contra el backend en modo simulado.

export const CONFIG = {
  API_URL: 'http://localhost:3000',
  SUPABASE_URL: '',
  SUPABASE_LLAVE_PUBLICA: '',
  TURNSTILE_LLAVE_SITIO: ''
};

/** Versión del aviso de privacidad. Cada cambio de texto debe subirla: queda guardada en cada consulta. */
export const AVISO_VERSION = '2026-11';

export const MODO_DESARROLLO = !CONFIG.SUPABASE_URL;
