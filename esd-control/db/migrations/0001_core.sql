-- =====================================================================
-- 0001_core: organizaciones, usuarios, sesiones, roles/permisos,
-- ubicaciones, procedimientos, categorías, criterios versionados,
-- activos, instrumentos, documentos y auditoría.
--
-- Convenciones:
--   * Todas las tablas con datos de cliente llevan org_id y RLS activado.
--   * La aplicación se conecta con el rol esd_app (sin BYPASSRLS y sin ser
--     propietario de las tablas), por lo que las políticas se aplican siempre.
--   * El contexto se fija por transacción con set_config('app.org_id', ..., true)
--     y set_config('app.user_id', ..., true).
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------
-- Funciones de contexto
-- ---------------------------------------------------------------------
create or replace function app_current_org() returns uuid
language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;

create or replace function app_current_user() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Organizaciones
-- ---------------------------------------------------------------------
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 200),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  is_demo     boolean not null default false,
  -- Configuración flexible y validada en la aplicación con Zod (política de
  -- instrumentos, días de aviso, gravedades por defecto, sufijo del lector...).
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_org_updated before update on organizations for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Usuarios (globales) y pertenencia a organizaciones
-- ---------------------------------------------------------------------
create table users (
  id             uuid primary key default gen_random_uuid(),
  email          citext not null unique check (length(email) <= 254),
  full_name      text not null check (length(full_name) between 1 and 200),
  password_hash  text not null,
  is_active      boolean not null default true,
  failed_logins  integer not null default 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  password_changed_at timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_users_updated before update on users for each row execute function touch_updated_at();

create table permissions (
  key          text primary key,
  description  text not null
);

insert into permissions(key, description) values
  ('read',             'Lectura de datos de la organización'),
  ('create',           'Creación de registros (activos, ubicaciones, planos, campañas, no conformidades)'),
  ('edit',             'Edición y archivado de registros'),
  ('measure',          'Registro de mediciones'),
  ('validate',         'Validación: invalidar mediciones, verificar y cerrar no conformidades'),
  ('campaign.close',   'Cierre de campañas'),
  ('criteria.manage',  'Gestión de criterios, procedimientos y categorías'),
  ('users.manage',     'Gestión de usuarios y roles'),
  ('instruments.manage','Gestión de instrumentos y calibraciones'),
  ('reports',          'Generación de informes'),
  ('export',           'Exportación de datos'),
  ('audit.read',       'Consulta del registro de auditoría'),
  ('settings.manage',  'Configuración de la organización, plantas y zonas');

create table roles (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete restrict,
  key          text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name         text not null,
  description  text,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (org_id, key)
);

create table role_permissions (
  role_id         uuid not null references roles(id) on delete cascade,
  org_id          uuid not null references organizations(id) on delete restrict,
  permission_key  text not null references permissions(key),
  primary key (role_id, permission_key)
);

create table memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete restrict,
  user_id     uuid not null references users(id) on delete restrict,
  role_id     uuid not null references roles(id) on delete restrict,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, user_id)
);
create index memberships_user_idx on memberships(user_id);
create trigger trg_memberships_updated before update on memberships for each row execute function touch_updated_at();

create table sessions (
  id            uuid primary key default gen_random_uuid(),
  token_hash    bytea not null unique,
  user_id       uuid not null references users(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  ip            text,
  user_agent    text
);
create index sessions_user_idx on sessions(user_id);

-- Permiso efectivo del usuario actual en la organización actual.
create or replace function app_has_permission(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from memberships m
      join role_permissions rp on rp.role_id = m.role_id
      join users u on u.id = m.user_id
     where m.user_id = app_current_user()
       and m.org_id  = app_current_org()
       and m.is_active and u.is_active
       and rp.permission_key = p_key
  )
$$;

create or replace function app_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join users u on u.id = m.user_id
     where m.user_id = app_current_user() and m.org_id = app_current_org()
       and m.is_active and u.is_active
  )
$$;

-- ---------------------------------------------------------------------
-- Funciones de autenticación (SECURITY DEFINER: la app no lee sessions
-- ni password_hash directamente).
-- ---------------------------------------------------------------------
create or replace function app_auth_find_user(p_email text)
returns table(id uuid, password_hash text, is_active boolean, locked_until timestamptz, full_name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.password_hash, u.is_active, u.locked_until, u.full_name
    from users u where u.email = p_email::citext
$$;

create or replace function app_auth_register_attempt(p_user uuid, p_success boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_success then
    update users set failed_logins = 0, locked_until = null, last_login_at = now() where id = p_user;
  else
    update users
       set failed_logins = failed_logins + 1,
           locked_until = case when failed_logins + 1 >= 5 then now() + interval '15 minutes' else locked_until end
     where id = p_user;
  end if;
end $$;

create or replace function app_auth_user_orgs(p_user uuid)
returns table(org_id uuid, org_name text, is_demo boolean, role_key text, role_name text)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.is_demo, r.key, r.name
    from memberships m
    join organizations o on o.id = m.org_id
    join roles r on r.id = m.role_id
   where m.user_id = p_user and m.is_active
   order by o.is_demo, o.name
$$;

create or replace function app_session_create(p_user uuid, p_org uuid, p_token_hash bytea, p_expires timestamptz, p_ip text, p_ua text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from memberships m join users u on u.id = m.user_id
                  where m.user_id = p_user and m.org_id = p_org and m.is_active and u.is_active) then
    raise exception 'El usuario no pertenece a la organización' using errcode = '42501';
  end if;
  insert into sessions(user_id, org_id, token_hash, expires_at, ip, user_agent)
  values (p_user, p_org, p_token_hash, p_expires, left(p_ip, 64), left(p_ua, 300))
  returning id into v_id;
  return v_id;
end $$;

create or replace function app_session_resolve(p_token_hash bytea)
returns table(session_id uuid, user_id uuid, org_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update sessions s set last_seen_at = now()
   where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
     and exists (select 1 from memberships m join users u on u.id = m.user_id
                  where m.user_id = s.user_id and m.org_id = s.org_id and m.is_active and u.is_active)
  returning s.id, s.user_id, s.org_id, s.expires_at;
end $$;

create or replace function app_session_revoke(p_token_hash bytea)
returns void language sql security definer set search_path = public as $$
  update sessions set revoked_at = now() where token_hash = p_token_hash and revoked_at is null
$$;

create or replace function app_session_revoke_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_has_permission('users.manage') and p_user <> app_current_user() then
    raise exception 'Permiso denegado' using errcode = '42501';
  end if;
  update sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
end $$;

-- Cambio de contraseña propio (el hash se calcula en la aplicación).
create or replace function app_auth_set_password(p_user uuid, p_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user <> app_current_user() and not app_has_permission('users.manage') then
    raise exception 'Permiso denegado' using errcode = '42501';
  end if;
  if p_user <> app_current_user() and not exists (
       select 1 from memberships where user_id = p_user and org_id = app_current_org()) then
    raise exception 'Usuario fuera de la organización' using errcode = '42501';
  end if;
  update users set password_hash = p_hash, password_changed_at = now(), failed_logins = 0, locked_until = null
   where id = p_user;
end $$;

-- Alta de usuario por un administrador de la organización actual.
create or replace function app_user_create(p_email text, p_name text, p_hash text, p_role uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not app_has_permission('users.manage') then
    raise exception 'Permiso denegado' using errcode = '42501';
  end if;
  if not exists (select 1 from roles where id = p_role and org_id = app_current_org()) then
    raise exception 'Rol no válido' using errcode = '22023';
  end if;
  select id into v_user from users where email = p_email::citext;
  if v_user is null then
    insert into users(email, full_name, password_hash) values (p_email, p_name, p_hash) returning id into v_user;
  end if;
  insert into memberships(org_id, user_id, role_id) values (app_current_org(), v_user, p_role)
  on conflict (org_id, user_id) do update set role_id = excluded.role_id, is_active = true;
  return v_user;
end $$;

-- ---------------------------------------------------------------------
-- Contadores para códigos legibles (NC-2026-0001, CMP-0001, ...)
-- ---------------------------------------------------------------------
create table org_counters (
  org_id  uuid not null references organizations(id) on delete restrict,
  key     text not null,
  value   bigint not null default 0,
  primary key (org_id, key)
);

create or replace function app_next_counter(p_key text) returns bigint
language plpgsql as $$
declare v bigint;
begin
  insert into org_counters(org_id, key, value) values (app_current_org(), p_key, 1)
  on conflict (org_id, key) do update set value = org_counters.value + 1
  returning value into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Ubicaciones: jerarquía flexible (empresa > planta > edificio > ... ).
-- No se impone profundidad ni orden de tipos.
-- ---------------------------------------------------------------------
create table locations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete restrict,
  parent_id    uuid references locations(id) on delete restrict,
  kind         text not null check (kind in ('company','plant','building','floor','area','zone','line','spot','other')),
  code         text not null check (length(code) between 1 and 40),
  name         text not null check (length(name) between 1 and 200),
  description  text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, code),
  check (parent_id is null or parent_id <> id)
);
create index locations_parent_idx on locations(org_id, parent_id);
create trigger trg_locations_updated before update on locations for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Documentos / adjuntos (metadatos; el binario vive en el almacenamiento).
-- ---------------------------------------------------------------------
create table documents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete restrict,
  entity_type  text not null check (entity_type in ('asset','instrument','calibration','nonconformity','measurement','floor_plan','procedure','organization','label')),
  entity_id    uuid,
  kind         text not null default 'attachment' check (kind in ('attachment','photo','certificate','plan_original','plan_page','logo','procedure')),
  file_name    text not null check (length(file_name) between 1 and 255),
  mime_type    text not null,
  size_bytes   bigint not null check (size_bytes > 0),
  sha256       text not null,
  storage_key  text not null unique,
  uploaded_by  uuid references users(id),
  created_at   timestamptz not null default now(),
  archived_at  timestamptz
);
create index documents_entity_idx on documents(org_id, entity_type, entity_id);

-- ---------------------------------------------------------------------
-- Procedimientos de medición (con revisión)
-- ---------------------------------------------------------------------
create table procedures (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete restrict,
  code          text not null check (length(code) between 1 and 40),
  title         text not null check (length(title) between 1 and 200),
  revision      text not null default 'A',
  norm_reference text,
  description   text,
  document_id   uuid references documents(id),
  is_active     boolean not null default true,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, code)
);
create trigger trg_procedures_updated before update on procedures for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Criterios de aceptación: familia + versiones inmutables
-- ---------------------------------------------------------------------
create table criteria (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete restrict,
  code        text not null check (length(code) between 1 and 40),
  name        text not null check (length(name) between 1 and 200),
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (org_id, code)
);

create table criterion_versions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete restrict,
  criterion_id        uuid not null references criteria(id) on delete restrict,
  version             integer not null check (version > 0),
  status              text not null check (status in ('draft','active','superseded','retired')),
  -- Reglas del motor (validadas con Zod en la aplicación). JSON justificado:
  -- la estructura depende del tipo (numérico, selección, checklist, multipunto).
  rules               jsonb not null,
  unit                text,
  procedure_id        uuid references procedures(id),
  procedure_revision  text,
  norm_reference      text,
  change_reason       text not null check (length(change_reason) between 3 and 2000),
  valid_from          timestamptz,
  approved_by         uuid references users(id),
  approved_at         timestamptz,
  created_by          uuid references users(id),
  created_at          timestamptz not null default now(),
  unique (criterion_id, version)
);
create unique index criterion_one_active on criterion_versions(criterion_id) where status = 'active';

-- Las versiones no se modifican salvo su estado (activar / sustituir / retirar).
create or replace function criterion_versions_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Una versión de criterio publicada no se puede borrar' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and (
       new.rules is distinct from old.rules or new.unit is distinct from old.unit
    or new.procedure_id is distinct from old.procedure_id or new.version <> old.version
    or new.criterion_id <> old.criterion_id or new.change_reason <> old.change_reason) then
    raise exception 'Una versión de criterio publicada es inmutable; cree una nueva versión' using errcode = '42501';
  end if;
  if old.status in ('superseded','retired') and new.status = 'active' then
    raise exception 'No se puede reactivar una versión sustituida; cree una nueva versión' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_criterion_versions_guard before update or delete on criterion_versions
  for each row execute function criterion_versions_guard();

-- ---------------------------------------------------------------------
-- Categorías
-- ---------------------------------------------------------------------
create table categories (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete restrict,
  code                 text not null check (length(code) between 1 and 40),
  name                 text not null check (length(name) between 1 and 200),
  description          text,
  inspection_type      text,
  quantity             text,             -- magnitud: resistencia a tierra, punto a punto, tensión...
  unit                 text,
  record_method        text not null default 'numeric' check (record_method in ('numeric','select','multipoint','checklist','combined')),
  procedure_id         uuid references procedures(id),
  criterion_id         uuid references criteria(id),
  period_unit          text check (period_unit in ('week','month','quarter','semester','year','day')),
  period_count         integer check (period_count is null or period_count > 0),
  instrument_required  boolean not null default true,
  instrument_types     text[] not null default '{}',
  required_fields      text[] not null default '{}',
  instructions         text,
  precautions          text,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id, code)
);
create trigger trg_categories_updated before update on categories for each row execute function touch_updated_at();

-- Plantillas multipunto (por categoría o por activo concreto)
create table point_templates (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete restrict,
  category_id  uuid references categories(id) on delete restrict,
  name         text not null,
  description  text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table point_template_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete restrict,
  template_id   uuid not null references point_templates(id) on delete cascade,
  code          text not null check (code ~ '^[A-Za-z0-9_.-]{1,20}$'),
  name          text not null,
  sort_order    integer not null default 0,
  instructions  text,
  unit          text,
  required      boolean not null default true,
  criterion_id  uuid references criteria(id),
  unique (template_id, code)
);

-- ---------------------------------------------------------------------
-- Activos
-- ---------------------------------------------------------------------
create table assets (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete restrict,
  code               text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9_.\-/]{0,39}$'),
  scan_code          text not null check (length(scan_code) between 1 and 120),
  name               text not null check (length(name) between 1 and 200),
  category_id        uuid not null references categories(id) on delete restrict,
  manufacturer       text,
  model              text,
  serial_number      text,
  location_id        uuid references locations(id) on delete restrict,
  commissioned_on    date not null default current_date,
  status             text not null default 'active' check (status in ('active','retired','repair','blocked','review')),
  owner_user_id      uuid references users(id),
  period_unit        text check (period_unit in ('week','month','quarter','semester','year','day')),
  period_count       integer check (period_count is null or period_count > 0),
  criterion_id       uuid references criteria(id),
  point_template_id  uuid references point_templates(id),
  notes              text,
  last_measurement_id uuid,
  last_measured_at   timestamptz,
  last_result        text,
  next_due_at        timestamptz,
  archived_at        timestamptz,
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, code),
  unique (org_id, scan_code)
);
create index assets_category_idx on assets(org_id, category_id);
create index assets_location_idx on assets(org_id, location_id);
create index assets_due_idx on assets(org_id, next_due_at) where archived_at is null;
create index assets_search_idx on assets using gin (to_tsvector('simple', coalesce(code,'') || ' ' || coalesce(name,'') || ' ' || coalesce(serial_number,'') || ' ' || coalesce(scan_code,'')));
create trigger trg_assets_updated before update on assets for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Instrumentos y calibraciones
-- ---------------------------------------------------------------------
create table instruments (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete restrict,
  code                text not null check (length(code) between 1 and 40),
  type                text not null check (length(type) between 1 and 100),
  manufacturer        text,
  model               text,
  serial_number       text,
  acquired_on         date,
  status              text not null default 'active' check (status in ('active','in_calibration','out_of_service','retired')),
  owner_user_id       uuid references users(id),
  location_id         uuid references locations(id),
  notes               text,
  last_calibrated_on  date,
  calibration_due_on  date,
  current_calibration_id uuid,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, code)
);
create trigger trg_instruments_updated before update on instruments for each row execute function touch_updated_at();

create table calibrations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete restrict,
  instrument_id       uuid not null references instruments(id) on delete restrict,
  calibrated_on       date not null,
  due_on              date not null,
  provider            text,
  certificate_number  text,
  outcome             text not null default 'pass' check (outcome in ('pass','fail','adjusted')),
  document_id         uuid references documents(id),
  notes               text,
  created_by          uuid references users(id),
  created_at          timestamptz not null default now(),
  check (due_on > calibrated_on)
);
create index calibrations_instrument_idx on calibrations(instrument_id, calibrated_on desc);

-- ---------------------------------------------------------------------
-- Auditoría (solo inserción)
-- ---------------------------------------------------------------------
create table audit_log (
  id           bigserial primary key,
  org_id       uuid not null references organizations(id) on delete restrict,
  user_id      uuid references users(id),
  at           timestamptz not null default now(),
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  summary      text not null,
  before_data  jsonb,
  after_data   jsonb,
  reason       text,
  ip           text
);
create index audit_org_at_idx on audit_log(org_id, at desc);
create index audit_entity_idx on audit_log(org_id, entity_type, entity_id);

create table audit_log_archive (like audit_log including all);

create or replace function audit_log_guard() returns trigger
language plpgsql as $$
begin
  if current_setting('app.audit_archiving', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'El registro de auditoría es de solo inserción' using errcode = '42501';
end $$;
create trigger trg_audit_guard before update or delete on audit_log for each row execute function audit_log_guard();
create trigger trg_audit_archive_guard before update or delete on audit_log_archive for each row execute function audit_log_guard();

-- Archivado: mueve eventos antiguos a audit_log_archive (sigue siendo consultable).
-- Solo ejecutable por el propietario del esquema (tarea de mantenimiento).
create or replace function audit_archive_before(p_before timestamptz) returns bigint
language plpgsql as $$
declare n bigint;
begin
  perform set_config('app.audit_archiving', 'on', true);
  with moved as (delete from audit_log where at < p_before returning *)
  insert into audit_log_archive select * from moved;
  get diagnostics n = row_count;
  perform set_config('app.audit_archiving', 'off', true);
  return n;
end $$;
revoke all on function audit_archive_before(timestamptz) from public;
