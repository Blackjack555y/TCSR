import { createHmac } from 'node:crypto';

/**
 * El documento del propietario y la IP del usuario nunca se guardan en claro:
 * solo un HMAC, que permite reconocer una consulta repetida sin poder revertirlo.
 */
export function crearHasher(secreto: string) {
  return (valor: string) => createHmac('sha256', secreto).update(valor).digest('hex');
}

export type Hasher = ReturnType<typeof crearHasher>;
