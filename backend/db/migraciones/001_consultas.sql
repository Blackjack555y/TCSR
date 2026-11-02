-- Carro Sin Rollos · esquema inicial (Supabase / PostgreSQL)
-- Pendiente de conectar: hoy el backend usa RepositorioMemoria y AlmacenamientoLocal.
-- Retención: la respuesta cruda de PlacApi NO se guarda (trae documento y nombres de terceros).
-- PENDIENTE DE VALIDACIÓN LEGAL: plazos de retención de consultas y consentimientos.

create table if not exists consultas (
  id               uuid primary key,
  placa            text not null,
  doc_type         text not null check (doc_type in ('CC', 'CE', 'NIT', 'PA', 'PPT')),
  doc_hash         text not null,          -- HMAC del documento; nunca el documento en claro
  estado           text not null check (estado in ('en_curso', 'generando_pdf', 'completada', 'error', 'vencida')),
  error_codigo     text,
  error_reintentable boolean,
  creditos_estimados integer,
  pdf_clave        text,                   -- ruta en el bucket privado "informes"
  vence_en         timestamptz,            -- fin de los 7 días de descarga
  creada_en        timestamptz not null default now(),
  actualizada_en   timestamptz not null default now()
);

create index if not exists consultas_reuso_idx on consultas (placa, doc_hash, creada_en desc);
create index if not exists consultas_vencidas_idx on consultas (vence_en) where pdf_clave is not null;

-- Informe ya normalizado y con datos de terceros enmascarados.
-- Se borra junto con el PDF al vencer.
create table if not exists informes (
  consulta_id         uuid primary key references consultas (id) on delete cascade,
  codigo_verificacion text not null unique,
  version_reglas      text not null,
  version_plantilla   text not null,
  nivel_general       text not null,
  contenido           jsonb not null,
  generado_en         timestamptz not null
);

-- Registro de la autorización de tratamiento de datos (Ley 1581 de 2012).
create table if not exists consentimientos (
  consulta_id    uuid primary key references consultas (id) on delete cascade,
  version_aviso  text not null,
  aceptado_en    timestamptz not null,
  ip_hash        text not null
);

-- Solo el backend (service role) accede. Sin políticas = nadie más puede leer ni escribir.
alter table consultas enable row level security;
alter table informes enable row level security;
alter table consentimientos enable row level security;

-- Bucket privado para los PDF:
-- insert into storage.buckets (id, name, public) values ('informes', 'informes', false);
