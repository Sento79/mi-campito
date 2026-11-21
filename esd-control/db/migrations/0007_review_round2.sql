-- =====================================================================
-- 0007: segunda ronda de revisión del PR #1.
-- =====================================================================

-- 1. Las funciones nuevas del propietario no son ejecutables por PUBLIC por defecto
alter default privileges in schema public revoke execute on functions from public;
revoke execute on function app_auth_find_user(text) from public;

-- 2. Un administrador de una organización no puede cambiar la contraseña global de una cuenta
--    que también pertenece a otra organización (cuenta compartida): solo su titular.
create or replace function app_auth_set_password(p_user uuid, p_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if app_current_user() is null or app_current_org() is null then
    raise exception 'Operación sin usuario autenticado' using errcode = '42501';
  end if;
  if p_user <> app_current_user() then
    if not app_has_permission('users.manage') then
      raise exception 'Permiso denegado' using errcode = '42501';
    end if;
    if not exists (select 1 from memberships where user_id = p_user and org_id = app_current_org()) then
      raise exception 'Usuario fuera de la organización' using errcode = '42501';
    end if;
    if exists (select 1 from memberships where user_id = p_user and org_id <> app_current_org()) then
      raise exception 'La cuenta pertenece también a otra organización: solo su titular puede cambiar la contraseña' using errcode = '42501';
    end if;
  end if;
  update users set password_hash = p_hash, password_changed_at = now(), failed_logins = 0, locked_until = null
   where id = p_user;
end $$;

-- 3. Revocar sesiones de otro usuario solo en la organización actual
create or replace function app_session_revoke_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if app_current_user() is null or app_current_org() is null then
    raise exception 'Operación sin usuario autenticado' using errcode = '42501';
  end if;
  if p_user = app_current_user() then
    update sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
    return;
  end if;
  if not (app_has_permission('users.manage') and app_user_in_org(p_user)) then
    raise exception 'Permiso denegado' using errcode = '42501';
  end if;
  update sessions set revoked_at = now() where user_id = p_user and org_id = app_current_org() and revoked_at is null;
end $$;

-- 4. Comprobación de organización también en actualizaciones
drop trigger if exists trg_refs_role_permissions on role_permissions;
create trigger trg_refs_role_permissions before insert or update on role_permissions for each row execute function app_check_refs('role_id:roles');
revoke update on role_permissions from esd_app;
drop trigger if exists trg_refs_floor_plan_versions on floor_plan_versions;
create trigger trg_refs_floor_plan_versions before insert or update on floor_plan_versions for each row execute function app_check_refs('plan_id:floor_plans', 'original_document_id:documents');
drop trigger if exists trg_refs_floor_plan_pages on floor_plan_pages;
create trigger trg_refs_floor_plan_pages before insert or update on floor_plan_pages for each row execute function app_check_refs('version_id:floor_plan_versions', 'image_document_id:documents');
drop trigger if exists trg_refs_nc_links on nc_links;
create trigger trg_refs_nc_links before insert or update on nc_links for each row execute function app_check_refs('nc_id:nonconformities', 'measurement_id:measurements', 'asset_id:assets', 'plan_point_id:plan_points');
drop trigger if exists trg_refs_campaign_categories on campaign_categories;
create trigger trg_refs_campaign_categories before insert or update on campaign_categories for each row execute function app_check_refs('campaign_id:campaigns', 'category_id:categories');
drop trigger if exists trg_refs_campaign_technicians on campaign_technicians;
create trigger trg_refs_campaign_technicians before insert or update on campaign_technicians for each row execute function app_check_refs('campaign_id:campaigns');
drop trigger if exists trg_refs_nc_status_history on nc_status_history;
create trigger trg_refs_nc_status_history before insert or update on nc_status_history for each row execute function app_check_refs('nc_id:nonconformities');
drop trigger if exists trg_refs_measurement_values on measurement_values;
create trigger trg_refs_measurement_values before insert or update on measurement_values for each row execute function app_check_refs('measurement_id:measurements');

-- 5. Valores de medición: bloqueo compartido del padre al comprobar su estado
create or replace function measurement_values_insert_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text; v_created timestamptz;
begin
  select status, created_at into v_status, v_created from measurements where id = new.measurement_id for share;
  if v_status is distinct from 'draft' and v_created is distinct from now() then
    raise exception 'No se pueden añadir valores a una medición ya registrada' using errcode = '42501';
  end if;
  return new;
end $$;

-- 6. Resúmenes: FOR NO KEY UPDATE es compatible con el KEY SHARE de las FK (evita interbloqueos
--    entre dos mediciones simultáneas del mismo activo). Los puntos de tipo activo solo reflejan
--    mediciones directas del activo (sin punto) o del propio punto.
create or replace function app_refresh_asset_summary(p_asset uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_last record;
  v_unit text; v_count int;
begin
  if p_asset is null then return; end if;
  perform 1 from assets where id = p_asset for no key update;
  select m.id, m.recorded_at, m.result into v_last
    from measurements m
   where m.asset_id = p_asset and m.status = 'final'
   order by m.recorded_at desc, m.created_at desc limit 1;
  select coalesce(a.period_unit, c.period_unit), coalesce(a.period_count, c.period_count)
    into v_unit, v_count
    from assets a join categories c on c.id = a.category_id where a.id = p_asset;
  update assets set
    last_measurement_id = v_last.id,
    last_measured_at = v_last.recorded_at,
    last_result = v_last.result,
    next_due_at = case
      when v_unit is null or v_count is null then null
      when v_last.id is null then null
      when v_last.result in ('pass') then v_last.recorded_at + app_period_interval(v_unit, v_count)
      else v_last.recorded_at
    end
  where id = p_asset;
end $$;

create or replace function app_refresh_point_summary(p_point uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_last record; v_asset uuid; v_type text;
begin
  if p_point is null then return; end if;
  select asset_id, point_type into v_asset, v_type from plan_points where id = p_point for no key update;
  select m.id, m.recorded_at, m.result into v_last
    from measurements m
   where m.status = 'final'
     and (m.plan_point_id = p_point
          or (v_type = 'asset' and v_asset is not null and m.asset_id = v_asset and m.plan_point_id is null))
   order by m.recorded_at desc, m.created_at desc limit 1;
  update plan_points set last_measurement_id = v_last.id, last_measured_at = v_last.recorded_at, last_result = v_last.result
   where id = p_point;
end $$;

create or replace function app_refresh_campaign_item(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_last record;
begin
  if p_item is null then return; end if;
  perform 1 from campaign_items where id = p_item for no key update;
  select m.id, m.recorded_at, m.result into v_last
    from measurements m where m.campaign_item_id = p_item and m.status = 'final'
   order by m.recorded_at desc, m.created_at desc limit 1;
  update campaign_items set
    last_measurement_id = v_last.id,
    measured_at = v_last.recorded_at,
    result = v_last.result,
    status = case when v_last.id is null then (case when status = 'skipped' then 'skipped' else 'pending' end) else 'done' end
  where id = p_item;
end $$;

-- Solo las mediciones directas del activo (sin punto) actualizan los puntos vinculados a él
create or replace function measurements_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if new.status = 'draft' then return new; end if;
  perform app_refresh_asset_summary(new.asset_id);
  if new.plan_point_id is not null then
    perform app_refresh_point_summary(new.plan_point_id);
  elsif new.asset_id is not null then
    for p in select id from plan_points where asset_id = new.asset_id and point_type = 'asset' and archived_at is null order by id loop
      perform app_refresh_point_summary(p.id);
    end loop;
  end if;
  perform app_refresh_campaign_item(new.campaign_item_id);
  return new;
end $$;

create index if not exists plan_points_asset_link_idx on plan_points(asset_id) where point_type = 'asset' and archived_at is null;

-- 7. Al cambiar el activo vinculado o el tipo de un punto, se recalcula su resumen
create or replace function plan_points_link_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app_refresh_point_summary(new.id);
  return new;
end $$;
create trigger trg_plan_points_link_changed after update of asset_id, point_type on plan_points
  for each row when (old.asset_id is distinct from new.asset_id or old.point_type is distinct from new.point_type)
  execute function plan_points_link_changed();

-- 8. Cambio de categoría del activo vs. cambio de periodicidad de la categoría: el recálculo del
--    activo espera al cambio en curso de su categoría (FOR SHARE choca con el bloqueo del UPDATE).
create or replace function assets_period_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from categories where id = new.category_id for share;
  perform app_refresh_asset_summary(new.id);
  return new;
end $$;

revoke execute on function plan_points_link_changed(), assets_period_changed(), measurement_values_insert_guard(),
  app_refresh_asset_summary(uuid), app_refresh_point_summary(uuid), app_refresh_campaign_item(uuid), measurements_after_change()
  from public, esd_app;

-- 9. Entrada original tal como la introdujo el técnico (también sin criterio vigente, cuando
--    la evaluación no produce valores normalizados): nunca se pierde el dato medido.
alter table measurements add column raw_input jsonb;
