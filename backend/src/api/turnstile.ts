// Cloudflare Turnstile: evita que un bot dispare consultas y gaste créditos.
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

export type VerificadorHumano = (token: string | undefined, ip: string) => Promise<boolean>;

export function crearVerificadorTurnstile(secreto: string | undefined): VerificadorHumano {
  // Sin secreto no se verifica. En producción queda una advertencia al arrancar (ver server.ts).
  if (!secreto) return async () => true;

  return async (token, ip) => {
    if (!token) return false;
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: secreto, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(10_000)
      });
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      return false;
    }
  };
}
