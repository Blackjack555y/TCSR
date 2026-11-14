-- Reintento gratis de un informe parcial y protección contra consultas duplicadas simultáneas.

-- Un informe parcial (alguna fuente falló) descuenta saldo. Si el usuario vuelve a consultar
-- el mismo vehículo dentro de 24 horas, esa segunda consulta no descuenta: queda enlazada aquí.
alter table consultas add column reintento_de uuid references consultas (id) on delete set null;
comment on column consultas.reintento_de is 'Consulta parcial que este reintento gratis completa. Solo se permite un reintento por consulta.';
create unique index consultas_un_reintento_idx on consultas (reintento_de) where reintento_de is not null;

-- Dos consultas iguales del mismo usuario no pueden estar en curso a la vez: la segunda
-- falla al insertarse, el backend devuelve su saldo y responde con la que ya está en curso.
create unique index consultas_una_en_curso_idx on consultas (usuario_id, huella)
  where estado in ('en_curso', 'generando_pdf');
