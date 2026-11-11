// Sesión del usuario: Supabase Auth en producción, cuentas de prueba locales en desarrollo.

import { CONFIG, MODO_DESARROLLO } from './config.js';

let cliente = null;

function supabase() {
  cliente ??= window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_LLAVE_PUBLICA);
  return cliente;
}

const urlDe = (pagina) => new URL(pagina, location.href).href;

function traducir(error) {
  const m = error?.message ?? '';
  if (/invalid login/i.test(m)) return 'El correo o la contraseña no son correctos.';
  if (/not confirmed/i.test(m)) return 'Confirma tu correo antes de ingresar: te enviamos un enlace.';
  if (/already registered|already exists/i.test(m)) return 'Ya existe una cuenta con ese correo.';
  if (/password/i.test(m)) return 'La contraseña no cumple los requisitos: usa al menos 8 caracteres.';
  if (/rate limit|too many/i.test(m)) return 'Hiciste muchos intentos. Espera unos minutos.';
  return 'No pudimos completar la acción. Intenta de nuevo.';
}

// ---------- desarrollo ----------

const CLAVE_DEV = 'csr-dev-sesion';
const leerDev = () => {
  try { return JSON.parse(localStorage.getItem(CLAVE_DEV)); } catch { return null; }
};
const guardarDev = (s) => localStorage.setItem(CLAVE_DEV, JSON.stringify(s));
const perfilesDev = () => {
  try { return JSON.parse(localStorage.getItem('csr-dev-perfiles')) ?? {}; } catch { return {}; }
};

// ---------- interfaz común ----------

export async function usuarioActual() {
  if (MODO_DESARROLLO) {
    const s = leerDev();
    return s ? { id: s.id, email: s.email } : null;
  }
  const { data } = await supabase().auth.getSession();
  const u = data.session?.user;
  return u ? { id: u.id, email: u.email } : null;
}

export async function tokenActual() {
  if (MODO_DESARROLLO) {
    const s = leerDev();
    return s ? `dev-${s.id}` : null;
  }
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Devuelve { sesion: true } si quedó adentro, o { confirmar: true } si debe confirmar el correo. */
export async function registrar({ nombre, email, clave }) {
  if (MODO_DESARROLLO) {
    const id = crypto.randomUUID();
    guardarDev({ id, email });
    localStorage.setItem('csr-dev-ids', JSON.stringify({ ...JSON.parse(localStorage.getItem('csr-dev-ids') ?? '{}'), [email]: id }));
    localStorage.setItem('csr-dev-perfiles', JSON.stringify({ ...perfilesDev(), [id]: { nombre } }));
    return { sesion: true };
  }
  const { data, error } = await supabase().auth.signUp({
    email,
    password: clave,
    options: { data: { nombre }, emailRedirectTo: urlDe('ingresar.html') }
  });
  if (error) throw new Error(traducir(error));
  return data.session ? { sesion: true } : { confirmar: true };
}

export async function ingresar({ email, clave }) {
  if (MODO_DESARROLLO) {
    // En desarrollo el mismo correo conserva su usuario, y con él su saldo.
    const ids = JSON.parse(localStorage.getItem('csr-dev-ids') ?? '{}');
    ids[email] ??= crypto.randomUUID();
    localStorage.setItem('csr-dev-ids', JSON.stringify(ids));
    guardarDev({ id: ids[email], email });
    return;
  }
  const { error } = await supabase().auth.signInWithPassword({ email, password: clave });
  if (error) throw new Error(traducir(error));
}

export async function salir() {
  if (MODO_DESARROLLO) {
    localStorage.removeItem(CLAVE_DEV);
    return;
  }
  await supabase().auth.signOut();
}

export async function pedirRecuperacion(email) {
  if (MODO_DESARROLLO) return;
  const { error } = await supabase().auth.resetPasswordForEmail(email, { redirectTo: urlDe('nueva-clave.html') });
  if (error) throw new Error(traducir(error));
}

export async function cambiarClave(clave) {
  if (MODO_DESARROLLO) return;
  const { error } = await supabase().auth.updateUser({ password: clave });
  if (error) throw new Error(traducir(error));
}

export async function leerPerfil() {
  const u = await usuarioActual();
  if (MODO_DESARROLLO) return perfilesDev()[u.id] ?? {};
  const { data, error } = await supabase().from('perfiles')
    .select('nombre, tipo_documento, numero_documento, telefono').eq('id', u.id).single();
  if (error) throw new Error('No pudimos cargar tus datos.');
  return data;
}

export async function guardarPerfil(datos) {
  const u = await usuarioActual();
  if (MODO_DESARROLLO) {
    localStorage.setItem('csr-dev-perfiles', JSON.stringify({ ...perfilesDev(), [u.id]: datos }));
    return;
  }
  const { error } = await supabase().from('perfiles').update({ ...datos, actualizado_en: new Date().toISOString() }).eq('id', u.id);
  if (error) throw new Error('No pudimos guardar tus datos.');
}
