-- Mi Campito · base de datos para la sincronización (Supabase)
-- Pegar entero en Supabase → SQL Editor → New query → Run.
-- Cada usuario solo puede ver y cambiar sus propios datos (Row Level Security).

create table if not exists public.datos (
  id       text        not null,
  user_id  uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  tabla    text        not null check (tabla in ('fincas','sectores','registros','ajustes')),
  datos    jsonb       not null,
  mod      timestamptz not null,
  borrado  boolean     not null default false,
  subido   timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists datos_user_subido on public.datos (user_id, subido);

alter table public.datos enable row level security;

drop policy if exists "leer lo mío" on public.datos;
drop policy if exists "crear lo mío" on public.datos;
drop policy if exists "cambiar lo mío" on public.datos;
drop policy if exists "borrar lo mío" on public.datos;
create policy "leer lo mío"    on public.datos for select using (user_id = auth.uid());
create policy "crear lo mío"   on public.datos for insert with check (user_id = auth.uid());
create policy "cambiar lo mío" on public.datos for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "borrar lo mío"  on public.datos for delete using (user_id = auth.uid());

-- La hora de subida la pone el servidor (para saber qué hay nuevo desde la última sincronización)
create or replace function public.datos_subido() returns trigger language plpgsql as $$
begin new.subido := now(); return new; end $$;
drop trigger if exists datos_subido on public.datos;
create trigger datos_subido before insert or update on public.datos for each row execute function public.datos_subido();

-- Fotos: carpeta privada por usuario
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', false) on conflict (id) do nothing;
drop policy if exists "fotos: lo mío" on storage.objects;
create policy "fotos: lo mío" on storage.objects for all
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
