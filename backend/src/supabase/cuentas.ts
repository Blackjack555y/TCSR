import type { SupabaseClient } from '@supabase/supabase-js';
import type { Compra, EstadoCompra, RepositorioCuentas, ResultadoAprobacion, Saldos } from '../cuentas/repositorio.js';
import type { TipoInforme } from '../dominio/tipos.js';

interface FilaCompra {
  id: string;
  usuario_id: string;
  tipo: TipoInforme;
  cantidad: number;
  precio_unitario: number;
  total: number;
  referencia: string;
  estado: EstadoCompra;
  creada_en: string;
}

const aCompra = (f: FilaCompra): Compra => ({
  id: f.id,
  usuarioId: f.usuario_id,
  tipo: f.tipo,
  cantidad: f.cantidad,
  precioUnitario: f.precio_unitario,
  total: f.total,
  referencia: f.referencia,
  estado: f.estado,
  creadaEn: f.creada_en
});

export class CuentasSupabase implements RepositorioCuentas {
  constructor(private readonly db: SupabaseClient) {}

  async saldos(usuarioId: string): Promise<Saldos> {
    const { data, error } = await this.db.from('saldos').select('tipo, disponibles').eq('usuario_id', usuarioId);
    if (error) throw new Error(`leer saldos: ${error.message}`);
    const s: Saldos = { basico: 0, vin: 0, full: 0 };
    for (const f of data as { tipo: TipoInforme; disponibles: number }[]) s[f.tipo] = f.disponibles;
    return s;
  }

  async crearCompra(c: Compra) {
    const { error } = await this.db.from('compras').insert({
      id: c.id,
      usuario_id: c.usuarioId,
      tipo: c.tipo,
      cantidad: c.cantidad,
      precio_unitario: c.precioUnitario,
      total: c.total,
      referencia: c.referencia,
      estado: c.estado,
      creada_en: c.creadaEn
    });
    if (error) throw new Error(`crear compra: ${error.message}`);
  }

  async obtenerCompra(id: string) {
    const { data, error } = await this.db.from('compras').select('*').eq('id', id).maybeSingle<FilaCompra>();
    if (error) throw new Error(`obtener compra: ${error.message}`);
    return data ? aCompra(data) : null;
  }

  async listarCompras(usuarioId: string, limite: number) {
    const { data, error } = await this.db.from('compras').select('*')
      .eq('usuario_id', usuarioId).order('creada_en', { ascending: false }).limit(limite).returns<FilaCompra[]>();
    if (error) throw new Error(`listar compras: ${error.message}`);
    return (data ?? []).map(aCompra);
  }

  async aprobarCompra(referencia: string, transaccionId: string, montoCentavos: number, medioPago: string | null) {
    const { data, error } = await this.db.rpc('aprobar_compra', {
      p_referencia: referencia, p_transaccion_id: transaccionId, p_monto_centavos: montoCentavos, p_medio_pago: medioPago
    });
    if (error) throw new Error(`aprobar compra: ${error.message}`);
    return data as ResultadoAprobacion;
  }

  async rechazarCompra(referencia: string, transaccionId: string) {
    const { error } = await this.db.from('compras')
      .update({ estado: 'rechazada', wompi_transaccion_id: transaccionId, resuelta_en: new Date().toISOString() })
      .eq('referencia', referencia).eq('estado', 'pendiente');
    if (error) throw new Error(`rechazar compra: ${error.message}`);
  }

  async consumirSaldo(usuarioId: string, tipo: TipoInforme, consultaId: string) {
    const { data, error } = await this.db.rpc('consumir_saldo', { p_usuario_id: usuarioId, p_tipo: tipo, p_consulta_id: consultaId });
    if (error) throw new Error(`consumir saldo: ${error.message}`);
    return data as boolean;
  }

  async devolverSaldo(consultaId: string) {
    const { data, error } = await this.db.rpc('devolver_saldo', { p_consulta_id: consultaId });
    if (error) throw new Error(`devolver saldo: ${error.message}`);
    return data as boolean;
  }
}
