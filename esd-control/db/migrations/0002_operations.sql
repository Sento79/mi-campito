-- =====================================================================
-- 0002_operations: planos, campañas, mediciones, no conformidades,
-- etiquetas y notificaciones.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Planos y versiones
-- ---------------------------------------------------------------------
create table floor_plans (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete restrict,
  title               text not null check (length(title) between 1 and 200),
  location_id         uuid references locations(id),
  owner_user_id       uuid references users(id),
  current_version_id  uuid,
  archived_at         timestamptz,
  created_by          uuid references users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_floor_plans_updated before update on floor_plans for each row execute function touch_updated_at();

create table floor_plan_versions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete restrict,
  plan_id          uuid not null references floor_plans(id) on delete restrict,
  version          integer not null check (version > 0),
  label            text,
  effective_on     date not null default current_date,
  original_document_id uuid not null references documents(id),
  page_count       integer not null check (page_count between 1 and 200),
  notes            text,
  created_by       uuid references users(id),
  created_at       timestamptz not null default now(),
  unique (plan_id, version)
);

create table floor_plan_pages (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete restrict,
  version_id         uuid not null references floor_plan_versions(id) on delete restrict,
  page_number        integer not null check (page_number > 0),
  image_document_id  uuid not null references documents(id),
  width_px           integer not null check (width_px > 0),
  height_px          integer not null check (height_px > 0),
  unique (version_id, page_number)
);

alter table floor_plans add constraint floor_plans_current_version_fk
  foreign key (current_version_id) references floor_plan_versions(id);

-- Puntos: coordenadas normalizadas 0..1 respecto a la página del plano.
create table plan_points (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete restrict,
  plan_id       uuid not null references floor_plans(id) on delete restrict,
  page_number   integer not null default 1 check (page_number > 0),
  code          text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9_.\-]{0,39}$'),
  name          text not null check (length(name) between 1 and 200),
  x             numeric(9,8) not null check (x >= 0 and x <= 1),
  y             numeric(9,8) not null check (y >= 0 and y <= 1),
  point_type    text not null default 'measurement' check (point_type in ('measurement','asset','reference')),
  category_id   uuid references categories(id),
  location_id   uuid references locations(id),
  asset_id      uuid references assets(id),
  criterion_id  uuid references criteria(id),
  route_order   integer,
  notes         text,
  last_measurement_id uuid,
  last_measured_at timestamptz,
  last_result   text,
  archived_at   timestamptz,
  archived_reason text,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (point_type <> 'asset' or asset_id is not null)
);
create unique index plan_points_code_uq on plan_points(plan_id, code) where archived_at is null;
create index plan_points_plan_idx on plan_points(org_id, plan_id);
create trigger trg_plan_points_updated before update on plan_points for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Campañas
-- ---------------------------------------------------------------------
create table campaigns (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete restrict,
  code           text not null,
  name           text not null check (length(name) between 1 and 200),
  description    text,
  location_id    uuid references locations(id),
  plan_id        uuid references floor_plans(id),
  starts_on      date not null,
  ends_on        date not null,
  owner_user_id  uuid references users(id),
  status         text not null default 'draft' check (status in ('draft','planned','in_progress','in_review','completed','closed','cancelled')),
  is_paused      boolean not null default false,
  creation_mode  text not null default 'manual' check (creation_mode in ('manual','category','location','plan','due','selection')),
  close_notes    text,
  closed_by      uuid references users(id),
  closed_at      timestamptz,
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, code),
  check (ends_on >= starts_on)
);
create trigger trg_campaigns_updated before update on campaigns for each row execute function touch_updated_at();

create table campaign_technicians (
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete restrict,
  user_id      uuid not null references users(id),
  primary key (campaign_id, user_id)
);

create table campaign_categories (
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete restrict,
  category_id  uuid not null references categories(id),
  primary key (campaign_id, category_id)
);

create table campaign_items (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete restrict,
  campaign_id         uuid not null references campaigns(id) on delete restrict,
  asset_id            uuid references assets(id),
  plan_point_id       uuid references plan_points(id),
  sort_order          integer not null default 0,
  status              text not null default 'pending' check (status in ('pending','done','skipped')),
  skip_reason         text,
  last_measurement_id uuid,
  result              text,
  measured_at         timestamptz,
  check (asset_id is not null or plan_point_id is not null)
);
create unique index campaign_items_asset_uq on campaign_items(campaign_id, asset_id) where asset_id is not null and plan_point_id is null;
create unique index campaign_items_point_uq on campaign_items(campaign_id, plan_point_id) where plan_point_id is not null;
create index campaign_items_campaign_idx on campaign_items(campaign_id, sort_order);

-- ---------------------------------------------------------------------
-- Mediciones (registro inalterable)
-- ---------------------------------------------------------------------
create table measurements (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete restrict,
  client_id            uuid not null,                         -- idempotencia (cola offline)
  status               text not null default 'final' check (status in ('draft','final','invalidated')),
  asset_id             uuid references assets(id),
  plan_point_id        uuid references plan_points(id),
  category_id          uuid references categories(id),
  campaign_id          uuid references campaigns(id),
  campaign_item_id     uuid references campaign_items(id),
  instrument_id        uuid references instruments(id),
  instrument_not_required boolean not null default false,
  instrument_snapshot  jsonb,          -- estado de calibración en el momento de medir
  procedure_id         uuid references procedures(id),
  procedure_revision   text,
  criterion_version_id uuid references criterion_versions(id),
  rules_snapshot       jsonb,          -- reglas exactas usadas para evaluar
  method               text not null check (method in ('numeric','select','multipoint','checklist','combined','none')),
  result               text not null check (result in ('pass','fail','pending','incomplete','not_measurable','not_applicable','review')),
  result_explanation   jsonb not null default '[]'::jsonb,
  not_measurable_reason text,
  comment              text,
  measured_by          uuid not null references users(id),
  recorded_at          timestamptz not null default now(),      -- hora del servidor
  measured_at_local    timestamptz,                             -- hora del dispositivo
  device_timezone      text,
  synced_from_offline  boolean not null default false,
  attempt_number       integer not null default 1,
  repeats_measurement_id uuid references measurements(id),
  signature_confirmed  boolean not null default false,
  invalidated_at       timestamptz,
  invalidated_by       uuid references users(id),
  invalidation_reason  text,
  created_at           timestamptz not null default now(),
  unique (org_id, client_id),
  check (asset_id is not null or plan_point_id is not null),
  check (result <> 'not_measurable' and result <> 'not_applicable' or not_measurable_reason is not null),
  check (status <> 'invalidated' or (invalidated_at is not null and invalidation_reason is not null))
);
create index measurements_asset_idx on measurements(org_id, asset_id, recorded_at desc);
create index measurements_point_idx on measurements(org_id, plan_point_id, recorded_at desc);
create index measurements_campaign_idx on measurements(org_id, campaign_id);
create index measurements_recorded_idx on measurements(org_id, recorded_at desc);

create table measurement_values (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete restrict,
  measurement_id    uuid not null references measurements(id) on delete cascade,
  point_code        text,
  point_name        text,
  part_code         text,
  value_kind        text not null check (value_kind in ('numeric','select','check')),
  raw_input         text,              -- texto exacto introducido
  raw_unit          text,
  raw_value         numeric,
  normalized_value  numeric,
  normalized_unit   text,
  option_value      text,
  checked           boolean,
  required          boolean not null default true,
  result            text not null check (result in ('pass','fail','pending','incomplete','not_measurable','not_applicable','review')),
  explanation       text,
  comment           text,
  sort_order        integer not null default 0
);
create index measurement_values_m_idx on measurement_values(measurement_id);

-- Inmutabilidad: una medición final solo puede pasar a 'invalidated'
-- (rellenando los campos de invalidación). Nunca se borra.
create or replace function measurements_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'draft' then return old; end if;
    raise exception 'Las mediciones registradas no se pueden borrar' using errcode = '42501';
  end if;
  if old.status = 'draft' then
    return new;
  end if;
  if old.status = 'invalidated' then
    raise exception 'La medición ya está invalidada y es inmutable' using errcode = '42501';
  end if;
  -- old.status = 'final'
  if new.status <> 'invalidated' then
    raise exception 'Una medición registrada es inmutable; repítala o invalídela' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['status','invalidated_at','invalidated_by','invalidation_reason'])
     is distinct from (to_jsonb(old) - array['status','invalidated_at','invalidated_by','invalidation_reason']) then
    raise exception 'Al invalidar solo se pueden registrar los datos de invalidación' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_measurements_guard before update or delete on measurements
  for each row execute function measurements_guard();

create or replace function measurement_values_guard() returns trigger
language plpgsql as $$
declare v_status text;
begin
  select status into v_status from measurements where id = coalesce(new.measurement_id, old.measurement_id);
  if v_status is distinct from 'draft' and (tg_op <> 'INSERT') then
    raise exception 'Los valores de una medición registrada son inmutables' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger trg_measurement_values_guard before update or delete on measurement_values
  for each row execute function measurement_values_guard();

-- ---------------------------------------------------------------------
-- No conformidades
-- ---------------------------------------------------------------------
create table nc_severities (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organizations(id) on delete restrict,
  key      text not null check (key ~ '^[a-z][a-z0-9_]{0,30}$'),
  name     text not null,
  rank     integer not null,
  due_days integer check (due_days is null or due_days > 0),
  unique (org_id, key)
);

create table nonconformities (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete restrict,
  code               text not null,
  title              text not null check (length(title) between 1 and 300),
  description        text,
  severity_id        uuid references nc_severities(id),
  status             text not null default 'open' check (status in ('open','containment','analysis','action','verification','closed','reopened')),
  owner_user_id      uuid references users(id),
  detected_at        timestamptz not null default now(),
  due_on             date,
  containment        text,
  root_cause         text,
  corrective_action  text,
  preventive_action  text,
  verification_notes text,
  verified_by        uuid references users(id),
  verified_at        timestamptz,
  closed_by          uuid references users(id),
  closed_at          timestamptz,
  reopen_count       integer not null default 0,
  campaign_id        uuid references campaigns(id),
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, code),
  -- No se puede cerrar sin verificación registrada.
  check (status <> 'closed' or (verified_by is not null and verified_at is not null
         and verification_notes is not null and length(verification_notes) >= 3
         and closed_by is not null and closed_at is not null))
);
create index nonconformities_status_idx on nonconformities(org_id, status);
create trigger trg_nonconformities_updated before update on nonconformities for each row execute function touch_updated_at();

create table nc_links (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete restrict,
  nc_id            uuid not null references nonconformities(id) on delete cascade,
  measurement_id   uuid references measurements(id),
  asset_id         uuid references assets(id),
  plan_point_id    uuid references plan_points(id),
  created_at       timestamptz not null default now(),
  check (measurement_id is not null or asset_id is not null or plan_point_id is not null)
);
create index nc_links_nc_idx on nc_links(nc_id);
create index nc_links_measurement_idx on nc_links(measurement_id);

create table nc_actions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete restrict,
  nc_id         uuid not null references nonconformities(id) on delete restrict,
  kind          text not null check (kind in ('containment','corrective','preventive')),
  description   text not null check (length(description) between 3 and 4000),
  owner_user_id uuid references users(id),
  due_on        date,
  status        text not null default 'open' check (status in ('open','done','cancelled')),
  completed_at  timestamptz,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now()
);
create index nc_actions_nc_idx on nc_actions(nc_id);

create table nc_status_history (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete restrict,
  nc_id       uuid not null references nonconformities(id) on delete restrict,
  from_status text,
  to_status   text not null,
  comment     text,
  changed_by  uuid references users(id),
  changed_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Etiquetas
-- ---------------------------------------------------------------------
create table label_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete restrict,
  name        text not null check (length(name) between 1 and 120),
  width_mm    numeric(6,2) not null check (width_mm between 10 and 300),
  height_mm   numeric(6,2) not null check (height_mm between 10 and 300),
  -- Configuración del diseñador (elementos visibles, tamaños, código...).
  layout      jsonb not null,
  is_default  boolean not null default false,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_label_templates_updated before update on label_templates for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Notificaciones dentro de la aplicación
-- ---------------------------------------------------------------------
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete restrict,
  user_id     uuid not null references users(id),
  kind        text not null,
  title       text not null,
  body        text,
  link        text check (link is null or link ~ '^/[A-Za-z0-9/_\-?=&.%]*$'),
  dedupe_key  text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create unique index notifications_dedupe_uq on notifications(org_id, user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_idx on notifications(org_id, user_id, created_at desc);
