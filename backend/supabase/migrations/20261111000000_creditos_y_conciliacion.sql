-- Créditos de PlacApi realmente usados, conciliación de pagos y límite de intentos fallidos.

-- La columna guarda los créditos de PlacApi que gastó cada consulta (antes era una estimación fija).
comment on column consultas.creditos_estimados is 'Créditos de PlacApi gastados por la consulta, según las llamadas que respondieron.';

-- Compras pendientes con transacción conocida: las revisa la conciliación con Wompi.
create index if not exists compras_pendientes_idx on compras (creada_en) where estado = 'pendiente';

-- Consultas fallidas por usuario: las cuenta el límite diario de intentos.
create index if not exists consultas_fallidas_idx on consultas (usuario_id, creada_en) where estado = 'error';

-- Resumen diario de gasto en PlacApi y de ventas (hora de Colombia). Solo lo lee el backend o el panel interno.
create view resumen_diario with (security_invoker = true) as
select
  d.dia,
  coalesce(c.consultas, 0)       as consultas,
  coalesce(c.fallidas, 0)        as consultas_fallidas,
  coalesce(c.creditos, 0)        as creditos_placapi,
  coalesce(v.compras, 0)         as compras_aprobadas,
  coalesce(v.ingresos, 0)        as ingresos_cop
from (
  select (creada_en at time zone 'America/Bogota')::date as dia from consultas
  union
  select (resuelta_en at time zone 'America/Bogota')::date from compras where estado = 'aprobada'
) d
left join (
  select (creada_en at time zone 'America/Bogota')::date as dia,
         count(*) as consultas,
         count(*) filter (where estado = 'error') as fallidas,
         sum(coalesce(creditos_estimados, 0)) as creditos
  from consultas group by 1
) c on c.dia = d.dia
left join (
  select (resuelta_en at time zone 'America/Bogota')::date as dia, count(*) as compras, sum(total) as ingresos
  from compras where estado = 'aprobada' group by 1
) v on v.dia = d.dia;

revoke all on resumen_diario from anon, authenticated;
