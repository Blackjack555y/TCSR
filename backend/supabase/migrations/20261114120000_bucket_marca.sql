-- Bucket público con el logo para los correos (plantillas de Supabase y avisos del backend).
-- El archivo se sube aparte: marca/logo-icono.png (copia de frontend/img/logo-icono.png).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marca', 'marca', true, 1048576, array['image/png', 'image/svg+xml', 'image/jpeg'])
on conflict (id) do nothing;
