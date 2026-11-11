import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eventoValido, firmaIntegridad, type EventoWompi } from '../src/pagos/wompi.js';
import { cotizar } from '../src/precios/catalogo.js';

describe('precios', () => {
  it.each([
    ['full', 1, 45_000], ['full', 5, 45_000], ['full', 6, 35_000], ['full', 50, 35_000],
    ['full', 51, 22_000], ['full', 200, 22_000], ['full', 201, 20_000],
    ['vin', 1, 37_000], ['vin', 6, 29_000], ['vin', 51, 18_500], ['vin', 201, 16_500],
    ['basico', 1, 22_500], ['basico', 6, 17_500], ['basico', 51, 11_000], ['basico', 201, 10_000]
  ] as const)('%s × %i = %i por unidad', (tipo, cantidad, unitario) => {
    const c = cotizar(tipo, cantidad);
    expect(c.precioUnitario).toBe(unitario);
    expect(c.total).toBe(unitario * cantidad);
  });

  it('avisa cuando comprar más sale más barato', () => {
    expect(cotizar('full', 5).mejorOpcion).toEqual({ cantidad: 6, precioUnitario: 35_000, total: 210_000, ahorro: 15_000 });
    expect(cotizar('full', 40).mejorOpcion?.cantidad).toBe(51);
    expect(cotizar('full', 1).mejorOpcion).toBeNull();
    expect(cotizar('full', 201).mejorOpcion).toBeNull();
  });

  it('rechaza cantidades inválidas', () => {
    expect(() => cotizar('full', 0)).toThrow(RangeError);
    expect(() => cotizar('full', 1.5)).toThrow(RangeError);
  });
});

describe('Wompi', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');

  it('firma de integridad: referencia + monto + moneda + secreto', () => {
    expect(firmaIntegridad('REF1', 4500000, 'COP', 'secreto')).toBe(sha('REF14500000COPsecreto'));
  });

  const evento = (): EventoWompi => {
    const data = { transaction: { id: 'T1', status: 'APPROVED', amount_in_cents: 4500000 } };
    const timestamp = 1530291411;
    return {
      event: 'transaction.updated', data, timestamp,
      signature: {
        properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
        checksum: sha(`T1APPROVED4500000${timestamp}secreto`).toUpperCase()
      }
    };
  };

  it('acepta un evento auténtico (el checksum llega en mayúsculas)', () => {
    expect(eventoValido(evento(), 'secreto')).toBe(true);
  });

  it('rechaza un evento alterado o con otro secreto', () => {
    const e = evento();
    (e.data as { transaction: { amount_in_cents: number } }).transaction.amount_in_cents = 100;
    expect(eventoValido(e, 'secreto')).toBe(false);
    expect(eventoValido(evento(), 'otro')).toBe(false);
    expect(eventoValido({ event: 'x', data: {}, timestamp: 1 } as never, 'secreto')).toBe(false);
  });
});
