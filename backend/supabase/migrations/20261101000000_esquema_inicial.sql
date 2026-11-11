-- Carro Sin Rollos · esquema inicial
-- PENDIENTE DE VALIDACIÓN LEGAL: plazos de retención de consultas, compras y consentimientos.
-- La respuesta cruda de PlacApi NO se guarda: trae documentos y nombres de terceros.

create type tipo_informe as enum ('basico', 'vin', 'full');
create type estado_consulta as enum ('en_curso', 'generando_pdf', 'completada', 'error', 'vencida');
create type estado_compra as enum ('pendiente', 'aprobada', 'rechazada');
create type motivo_movimiento as enum ('compra', 'consumo', 'devolucion');

-- ---------------------------------------------------------------------------
-- Usuarios
-- ---------------------------------------------------------------------------

-- Datos del cliente. El inicio de sesión lo maneja Supabase Auth (auth.users).
-- Los datos de facturación son opcionales hasta definir con el contador qué se exige.
create table perfiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  nombre           text,
  tipo_documento   text check (tipo_documento in ('CC', 'CE', 'NIT', 'PA', 'PPT')),
  numero_documento text,
  telefono         text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);

create function crear_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfiles (id, nombre) values (new.id, new.raw_user_meta_data ->> 'nombre');
  return new;
end $$;

create trigger al_crear_usuario after insert on auth.users
  for each row execute function crear_perfil();

-- ---------------------------------------------------------------------------
-- Compras y saldo
-- ---------------------------------------------------------------------------

create table compras (
  id                     uuid primary key,
  usuario_id             uuid not null references auth.users (id) on delete restrict,
  tipo                   tipo_informe not null,
  cantidad               integer not null check (cantidad > 0),
  precio_unitario        integer not null check (precio_unitario > 0),   -- COP con IVA
  total                  integer not null check (total > 0),             -- COP con IVA
  referencia             text not null unique,                           -- referencia enviada a Wompi
  estado                 estado_compra not null default 'pendiente',
  wompi_transaccion_id   text unique,
  medio_pago             text,
  creada_en              timestamptz not null default now(),
  resuelta_en            timestamptz,
  check (total = cantidad * precio_unitario)
);
create index compras_usuario_idx on compras (usuario_id, creada_en desc);

-- Saldo por tipo de informe: cada compra sirve para un solo tipo. No vence.
create table saldos (
  usuario_id  uuid not null references auth.users (id) on delete restrict,
  tipo        tipo_informe not null,
  disponibles integer not null default 0 check (disponibles >= 0),
  primary key (usuario_id, tipo)
);

-- Registro de todo movimiento del saldo. Los índices únicos hacen idempotentes
-- las operaciones: un evento de Wompi repetido no acredita dos veces.
create table movimientos_saldo (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references auth.users (id) on delete restrict,
  tipo        tipo_informe not null,
  delta       integer not null check (delta <> 0),
  motivo      motivo_movimiento not null,
  compra_id   uuid references compras (id),
  consulta_id uuid,    -- sin FK: el consumo se registra antes de crear la consulta
  creado_en   timestamptz not null default now()
);
create unique index movimientos_compra_unica on movimientos_saldo (compra_id) where motivo = 'compra';
create unique index movimientos_consumo_unico on movimientos_saldo (consulta_id) where motivo = 'consumo';
create unique index movimientos_devolucion_unica on movimientos_saldo (consulta_id) where motivo = 'devolucion';
create index movimientos_usuario_idx on movimientos_saldo (usuario_id, creado_en desc);

-- ---------------------------------------------------------------------------
-- Consultas
-- ---------------------------------------------------------------------------

create table consultas (
  id                  uuid primary key,
  usuario_id          uuid references auth.users (id) on delete set null,
  tipo                tipo_informe not null,
  placa               text,                 -- en Por VIN se conoce al responder la fuente
  vin                 text,
  doc_type            text check (doc_type in ('CC', 'CE', 'NIT', 'PA', 'PPT')),
  doc_hash            text,                 -- HMAC del documento; nunca el documento en claro
  huella              text not null,        -- identifica tipo + vehículo + documento para reutilizar
  estado              estado_consulta not null,
  error_codigo        text,
  error_reintentable  boolean,
  saldo_devuelto      boolean not null default false,
  creditos_estimados  integer,
  parcial             boolean not null default false,
  codigo_verificacion text unique,
  informe             jsonb,                -- solo datos del vehículo; se borra al vencer
  pdf_clave           text,                 -- ruta en el bucket privado "informes"
  vence_en            timestamptz,
  creada_en           timestamptz not null default now(),
  actualizada_en      timestamptz not null default now()
);
create index consultas_usuario_idx on consultas (usuario_id, creada_en desc);
create index consultas_reuso_idx on consultas (usuario_id, huella, creada_en desc);
create index consultas_vencidas_idx on consultas (vence_en) where pdf_clave is not null;

-- Prueba de la autorización de tratamiento de datos (Ley 1581 de 2012).
-- Se conserva aunque el usuario se elimine.
create table consentimientos (
  consulta_id   uuid primary key references consultas (id) on delete cascade,
  version_aviso text not null,
  aceptado_en   timestamptz not null,
  ip_hash       text not null
);

-- ---------------------------------------------------------------------------
-- Operaciones atómicas del saldo (las llama solo el backend)
-- ---------------------------------------------------------------------------

-- Marca una compra como aprobada y acredita el saldo una sola vez.
-- Si el monto no coincide no acredita: alguien pudo alterar el pago.
create function aprobar_compra(p_referencia text, p_transaccion_id text, p_monto_centavos bigint, p_medio_pago text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  c public.compras;
begin
  select * into c from public.compras where referencia = p_referencia for update;
  if not found then return 'no_existe'; end if;
  if c.estado = 'aprobada' then return 'ya_aprobada'; end if;
  if p_monto_centavos <> c.total::bigint * 100 then return 'monto_no_coincide'; end if;

  -- Una compra rechazada se puede aprobar: el cliente pudo reintentar el pago con la misma referencia.
  update public.compras
     set estado = 'aprobada', wompi_transaccion_id = p_transaccion_id,
         medio_pago = p_medio_pago, resuelta_en = now()
   where id = c.id;

  insert into public.saldos (usuario_id, tipo, disponibles) values (c.usuario_id, c.tipo, c.cantidad)
  on conflict (usuario_id, tipo) do update set disponibles = public.saldos.disponibles + excluded.disponibles;

  insert into public.movimientos_saldo (usuario_id, tipo, delta, motivo, compra_id)
  values (c.usuario_id, c.tipo, c.cantidad, 'compra', c.id);

  return 'aprobada';
end $$;

-- Descuenta un informe del saldo. Devuelve false si no hay saldo.
create function consumir_saldo(p_usuario_id uuid, p_tipo public.tipo_informe, p_consulta_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.saldos set disponibles = disponibles - 1
   where usuario_id = p_usuario_id and tipo = p_tipo and disponibles > 0;
  if not found then return false; end if;

  insert into public.movimientos_saldo (usuario_id, tipo, delta, motivo, consulta_id)
  values (p_usuario_id, p_tipo, -1, 'consumo', p_consulta_id);
  return true;
end $$;

-- Devuelve el informe consumido por una consulta fallida, una sola vez.
create function devolver_saldo(p_consulta_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  m public.movimientos_saldo;
begin
  select * into m from public.movimientos_saldo
   where consulta_id = p_consulta_id and motivo = 'consumo' for update;
  if not found then return false; end if;

  insert into public.movimientos_saldo (usuario_id, tipo, delta, motivo, consulta_id)
  values (m.usuario_id, m.tipo, 1, 'devolucion', p_consulta_id)
  on conflict do nothing;
  if not found then return false; end if;

  update public.saldos set disponibles = disponibles + 1
   where usuario_id = m.usuario_id and tipo = m.tipo;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------------

-- Todo pasa por el backend, salvo que cada usuario lee y edita su propio perfil.
alter table perfiles enable row level security;
alter table compras enable row level security;
alter table saldos enable row level security;
alter table movimientos_saldo enable row level security;
alter table consultas enable row level security;
alter table consentimientos enable row level security;

create policy perfil_leer_propio on perfiles for select to authenticated using (id = auth.uid());
create policy perfil_editar_propio on perfiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke execute on function aprobar_compra(text, text, bigint, text) from public, anon, authenticated;
revoke execute on function consumir_saldo(uuid, public.tipo_informe, uuid) from public, anon, authenticated;
revoke execute on function devolver_saldo(uuid) from public, anon, authenticated;
revoke execute on function crear_perfil() from public, anon, authenticated;
grant execute on function aprobar_compra(text, text, bigint, text) to service_role;
grant execute on function consumir_saldo(uuid, public.tipo_informe, uuid) to service_role;
grant execute on function devolver_saldo(uuid) to service_role;

-- Bucket privado para los PDF.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('informes', 'informes', false, 5242880, array['application/pdf']);
