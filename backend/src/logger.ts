// Logger mínimo en JSON. Nunca recibe el documento del propietario ni respuestas
// crudas de las fuentes: quien llama solo pasa ids, placas y códigos de error.

type Nivel = 'info' | 'warn' | 'error';

function log(nivel: Nivel, mensaje: string, datos?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'test') return;
  const linea = JSON.stringify({ t: new Date().toISOString(), nivel, mensaje, ...datos });
  (nivel === 'error' ? console.error : console.log)(linea);
}

export const logger = {
  info: (m: string, d?: Record<string, unknown>) => log('info', m, d),
  warn: (m: string, d?: Record<string, unknown>) => log('warn', m, d),
  error: (m: string, d?: Record<string, unknown>) => log('error', m, d)
};
