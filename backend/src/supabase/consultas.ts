import type { SupabaseClient } from '@supabase/supabase-js';
import type { CodigoErrorSistema, Consulta, EstadoSistema } from '../consultas/modelo.js';
import type { RepositorioConsultas } from '../consultas/repositorio.js';
import type { Informe, TipoInforme } from '../dominio/tipos.js';
import type { TipoDocumento } from '../placapi/tipos.js';

interface Fila {
  id: string;
  usuario_id: string;
  tipo: TipoInforme;
  placa: string | null;
  vin: string | null;
  doc_type: TipoDocumento | null;
  doc_hash: string | null;
  huella: string;
  estado: EstadoSistema;
  error_codigo: CodigoErrorSistema | null;
  error_reintentable: boolean | null;
  saldo_devuelto: boolean;
  creditos_estimados: number | null;
  parcial: boolean;
  codigo_verificacion: string | null;
  informe: Informe | null;
  pdf_clave: string | null;
  vence_en: string | null;
  creada_en: string;
  actualizada_en: string;
  consentimientos: { version_aviso: string; aceptado_en: string; ip_hash: string } | null;
}

const COLUMNAS = '*, consentimientos(version_aviso, aceptado_en, ip_hash)';

function aConsulta(f: Fila): Consulta {
  return {
    id: f.id,
    usuarioId: f.usuario_id,
    tipo: f.tipo,
    placa: f.placa,
    vin: f.vin,
    docType: f.doc_type,
    docHash: f.doc_hash,
    huella: f.huella,
    estado: f.estado,
    creadaEn: f.creada_en,
    actualizadaEn: f.actualizada_en,
    consentimiento: {
      version: f.consentimientos?.version_aviso ?? '',
      aceptadoEn: f.consentimientos?.aceptado_en ?? '',
      ipHash: f.consentimientos?.ip_hash ?? ''
    },
    saldoDevuelto: f.saldo_devuelto,
    parcial: f.parcial,
    ...(f.error_codigo && { error: { codigo: f.error_codigo, reintentable: f.error_reintentable ?? true } }),
    ...(f.informe && { informe: f.informe }),
    ...(f.pdf_clave && { pdfClave: f.pdf_clave }),
    ...(f.vence_en && { venceEn: f.vence_en }),
    ...(f.creditos_estimados != null && { creditosEstimados: f.creditos_estimados })
  };
}

/** Traduce los cambios a columnas. `undefined` explícito significa borrar el valor. */
function aColumnas(c: Partial<Consulta>): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if ('estado' in c) f.estado = c.estado;
  if ('placa' in c) f.placa = c.placa;
  if ('parcial' in c) f.parcial = c.parcial;
  if ('saldoDevuelto' in c) f.saldo_devuelto = c.saldoDevuelto;
  if ('pdfClave' in c) f.pdf_clave = c.pdfClave ?? null;
  if ('venceEn' in c) f.vence_en = c.venceEn ?? null;
  if ('error' in c) {
    f.error_codigo = c.error?.codigo ?? null;
    f.error_reintentable = c.error?.reintentable ?? null;
  }
  if ('informe' in c) {
    f.informe = c.informe ?? null;
    if (c.informe) f.codigo_verificacion = c.informe.codigoVerificacion;
  }
  return f;
}

export class ConsultasSupabase implements RepositorioConsultas {
  constructor(private readonly db: SupabaseClient) {}

  async crear(c: Consulta) {
    const { error } = await this.db.from('consultas').insert({
      id: c.id,
      usuario_id: c.usuarioId,
      tipo: c.tipo,
      placa: c.placa,
      vin: c.vin,
      doc_type: c.docType,
      doc_hash: c.docHash,
      huella: c.huella,
      estado: c.estado,
      creditos_estimados: c.creditosEstimados ?? null,
      creada_en: c.creadaEn,
      actualizada_en: c.actualizadaEn
    });
    if (error) throw new Error(`crear consulta: ${error.message}`);

    const { error: e2 } = await this.db.from('consentimientos').insert({
      consulta_id: c.id,
      version_aviso: c.consentimiento.version,
      aceptado_en: c.consentimiento.aceptadoEn,
      ip_hash: c.consentimiento.ipHash
    });
    if (e2) throw new Error(`crear consentimiento: ${e2.message}`);
  }

  async obtener(id: string) {
    const { data, error } = await this.db.from('consultas').select(COLUMNAS).eq('id', id).maybeSingle<Fila>();
    if (error) throw new Error(`obtener consulta: ${error.message}`);
    return data ? aConsulta(data) : null;
  }

  async actualizar(id: string, cambios: Partial<Consulta>) {
    const { data, error } = await this.db
      .from('consultas')
      .update({ ...aColumnas(cambios), actualizada_en: new Date().toISOString() })
      .eq('id', id)
      .select(COLUMNAS)
      .maybeSingle<Fila>();
    if (error) throw new Error(`actualizar consulta: ${error.message}`);
    return data ? aConsulta(data) : null;
  }

  async listarDeUsuario(usuarioId: string, limite: number) {
    const { data, error } = await this.db.from('consultas').select(COLUMNAS)
      .eq('usuario_id', usuarioId).order('creada_en', { ascending: false }).limit(limite).returns<Fila[]>();
    if (error) throw new Error(`listar consultas: ${error.message}`);
    return (data ?? []).map(aConsulta);
  }

  async buscarReciente(usuarioId: string, huella: string, desde: string) {
    const { data, error } = await this.db.from('consultas').select(COLUMNAS)
      .eq('usuario_id', usuarioId).eq('huella', huella).gte('creada_en', desde)
      .order('creada_en', { ascending: false }).limit(1).maybeSingle<Fila>();
    if (error) throw new Error(`buscar consulta: ${error.message}`);
    return data ? aConsulta(data) : null;
  }

  async listarVencidas(ahora: string) {
    const { data, error } = await this.db.from('consultas').select(COLUMNAS)
      .not('pdf_clave', 'is', null).lt('vence_en', ahora).returns<Fila[]>();
    if (error) throw new Error(`listar vencidas: ${error.message}`);
    return (data ?? []).map(aConsulta);
  }

  async listarColgadas(antesDe: string) {
    const { data, error } = await this.db.from('consultas').select(COLUMNAS)
      .in('estado', ['en_curso', 'generando_pdf']).lt('creada_en', antesDe).returns<Fila[]>();
    if (error) throw new Error(`listar colgadas: ${error.message}`);
    return (data ?? []).map(aConsulta);
  }
}
