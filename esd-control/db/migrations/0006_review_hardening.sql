-- =====================================================================
-- 0006: endurecimiento tras la revisión del PR #1.
--   * Funciones de autorización sin actor
--   * EXECUTE solo en las funciones que la aplicación necesita
--   * Coherencia de organización en todas las referencias (las FK no ven RLS)
--   * Cierres de campañas/NC también en INSERT
--   * Lectura de users sin password_hash
--   * Transiciones de versiones de criterio y valores de mediciones finalizadas
--   * Recorridos de ubicaciones a prueba de ciclos
--   * Bloqueos en el recálculo de resúmenes; periodo heredado de la categoría
--   * Puntos de plano vinculados a activos; destinatarios de alertas
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Funciones con actor obligatorio
-- ---------------------------------------------------------------------
create or replace function app_auth_set_password(p_user uuid, p_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if app_current_user() is null or app_current_org() is null then
    raise exception 'Operación sin usuario autenticado' using errcode = '42501';
  end if;
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

create or replace function app_session_revoke_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if app_current_user() is null then
    raise exception 'Operación sin usuario autenticado' using errcode = '42501';
  end if;
  if p_user <> app_current_user() and not (app_has_permission('users.manage') and app_user_in_org(p_user)) then
    raise exception 'Permiso denegado' using errcode = '42501';
  end if;
  update sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
end $$;

-- ---------------------------------------------------------------------
-- 2. Lectura de users sin password_hash
-- ---------------------------------------------------------------------
revoke select on users from esd_app;
grant select (id, email, full_name, is_active, failed_logins, locked_until, last_login_at, password_changed_at, created_at, updated_at) on users to esd_app;

-- ---------------------------------------------------------------------
-- 3. Coherencia de organización en referencias
--    Uso: trigger ... execute function app_check_refs('columna:tabla', ...)
-- ---------------------------------------------------------------------
create or replace function app_check_refs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  i int; col text; tbl text; v text; o uuid;
begin
  for i in 0 .. tg_nargs - 1 loop
    col := split_part(tg_argv[i], ':', 1);
    tbl := split_part(tg_argv[i], ':', 2);
    v := to_jsonb(new) ->> col;
    if v is null then continue; end if;
    execute format('select org_id from %I where id = $1', tbl) into o using v::uuid;
    if o is null or o <> new.org_id then
      raise exception 'Referencia no válida en %: no pertenece a la organización', col using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

create trigger trg_refs_measurements before insert or update on measurements for each row execute function app_check_refs(
  'asset_id:assets', 'plan_point_id:plan_points', 'category_id:categories', 'campaign_id:campaigns', 'campaign_item_id:campaign_items',
  'instrument_id:instruments', 'criterion_version_id:criterion_versions', 'procedure_id:procedures', 'repeats_measurement_id:measurements');
create trigger trg_refs_measurement_values before insert on measurement_values for each row execute function app_check_refs('measurement_id:measurements');
create trigger trg_refs_criterion_versions before insert or update on criterion_versions for each row execute function app_check_refs('criterion_id:criteria', 'procedure_id:procedures');
create trigger trg_refs_categories before insert or update on categories for each row execute function app_check_refs('procedure_id:procedures', 'criterion_id:criteria');
create trigger trg_refs_point_templates before insert or update on point_templates for each row execute function app_check_refs('category_id:categories');
create trigger trg_refs_point_template_items before insert or update on point_template_items for each row execute function app_check_refs('template_id:point_templates', 'criterion_id:criteria');
create trigger trg_refs_assets before insert or update on assets for each row execute function app_check_refs('category_id:categories', 'location_id:locations', 'criterion_id:criteria', 'point_template_id:point_templates');
create trigger trg_refs_locations before insert or update on locations for each row execute function app_check_refs('parent_id:locations');
create trigger trg_refs_procedures before insert or update on procedures for each row execute function app_check_refs('document_id:documents');
create trigger trg_refs_instruments before insert or update on instruments for each row execute function app_check_refs('location_id:locations');
create trigger trg_refs_calibrations before insert or update on calibrations for each row execute function app_check_refs('instrument_id:instruments', 'document_id:documents');
create trigger trg_refs_floor_plans before insert or update on floor_plans for each row execute function app_check_refs('location_id:locations', 'current_version_id:floor_plan_versions');
create trigger trg_refs_floor_plan_versions before insert on floor_plan_versions for each row execute function app_check_refs('plan_id:floor_plans', 'original_document_id:documents');
create trigger trg_refs_floor_plan_pages before insert on floor_plan_pages for each row execute function app_check_refs('version_id:floor_plan_versions', 'image_document_id:documents');
create trigger trg_refs_plan_points before insert or update on plan_points for each row execute function app_check_refs('plan_id:floor_plans', 'category_id:categories', 'location_id:locations', 'asset_id:assets', 'criterion_id:criteria');
create trigger trg_refs_campaigns before insert or update on campaigns for each row execute function app_check_refs('location_id:locations', 'plan_id:floor_plans');
create trigger trg_refs_campaign_items before insert or update on campaign_items for each row execute function app_check_refs('campaign_id:campaigns', 'asset_id:assets', 'plan_point_id:plan_points');
create trigger trg_refs_campaign_categories before insert on campaign_categories for each row execute function app_check_refs('campaign_id:campaigns', 'category_id:categories');
create trigger trg_refs_campaign_technicians before insert on campaign_technicians for each row execute function app_check_refs('campaign_id:campaigns');
create trigger trg_refs_nonconformities before insert or update on nonconformities for each row execute function app_check_refs('severity_id:nc_severities', 'campaign_id:campaigns');
create trigger trg_refs_nc_links before insert on nc_links for each row execute function app_check_refs('nc_id:nonconformities', 'measurement_id:measurements', 'asset_id:assets', 'plan_point_id:plan_points');
create trigger trg_refs_nc_actions before insert or update on nc_actions for each row execute function app_check_refs('nc_id:nonconformities');
create trigger trg_refs_nc_status_history before insert on nc_status_history for each row execute function app_check_refs('nc_id:nonconformities');
create trigger trg_refs_role_permissions before insert on role_permissions for each row execute function app_check_refs('role_id:roles');

-- El técnico de una campaña debe ser miembro de la organización
create or replace function campaign_technicians_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from memberships where user_id = new.user_id and org_id = new.org_id) then
    raise exception 'El técnico no pertenece a la organización' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_campaign_technicians_member before insert on campaign_technicians for each row execute function campaign_technicians_member();

-- La versión vigente de un plano debe ser suya
create or replace function floor_plans_current_version() returns trigger
language plpgsql as $$
begin
  if new.current_version_id is not null and not exists (
       select 1 from floor_plan_versions v where v.id = new.current_version_id and v.plan_id = new.id) then
    raise exception 'La versión vigente no pertenece a este plano' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_floor_plans_current_version before insert or update of current_version_id on floor_plans
  for each row execute function floor_plans_current_version();

-- ---------------------------------------------------------------------
-- 4. Estados iniciales: no se crean campañas ni NC ya cerradas
-- ---------------------------------------------------------------------
create or replace function no_closed_on_insert() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'campaigns' and new.status not in ('draft', 'planned', 'in_progress') then
    raise exception 'Una campaña nueva debe crearse en borrador, planificada o en curso' using errcode = '42501';
  end if;
  if tg_table_name = 'nonconformities' and new.status not in ('open', 'containment') then
    raise exception 'Una no conformidad nueva debe crearse abierta o en contención' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_campaigns_insert_state before insert on campaigns for each row execute function no_closed_on_insert();
create trigger trg_nonconformities_insert_state before insert on nonconformities for each row execute function no_closed_on_insert();

-- ---------------------------------------------------------------------
-- 5. Versiones de criterio: una versión publicada nunca vuelve a borrador
-- ---------------------------------------------------------------------
create or replace function criterion_versions_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Una versión de criterio publicada no se puede borrar' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and new.status = 'draft' then
    raise exception 'Una versión publicada no puede volver a borrador' using errcode = '42501';
  end if;
  if old.status <> 'draft' and (
       new.rules is distinct from old.rules or new.unit is distinct from old.unit
    or new.procedure_id is distinct from old.procedure_id or new.version <> old.version
    or new.criterion_id <> old.criterion_id or new.change_reason <> old.change_reason) then
    raise exception 'Una versión de criterio publicada es inmutable; cree una nueva versión' using errcode = '42501';
  end if;
  if old.status in ('superseded', 'retired') and new.status <> old.status then
    raise exception 'Una versión sustituida o retirada no cambia de estado; cree una nueva versión' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 6. Valores de medición: solo en la misma transacción que crea la
--    medición (o mientras es borrador). No se pueden añadir después.
-- ---------------------------------------------------------------------
create or replace function measurement_values_insert_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text; v_created timestamptz;
begin
  select status, created_at into v_status, v_created from measurements where id = new.measurement_id;
  if v_status is distinct from 'draft' and v_created is distinct from now() then
    raise exception 'No se pueden añadir valores a una medición ya registrada' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_measurement_values_insert_guard before insert on measurement_values
  for each row execute function measurement_values_insert_guard();

-- ---------------------------------------------------------------------
-- 7. Ubicaciones a prueba de ciclos
-- ---------------------------------------------------------------------
create or replace function app_location_subtree(p_root uuid) returns setof uuid
language sql stable as $$
  with recursive t(id) as (
    select id from locations where id = p_root
    union
    select l.id from locations l join t on l.parent_id = t.id
  ) select id from t
$$;

create or replace function app_location_path(p_id uuid) returns text
language sql stable as $$
  with recursive t(id, parent_id, name, kind, depth, seen) as (
    select id, parent_id, name, kind, 0, array[id] from locations where id = p_id
    union all
    select l.id, l.parent_id, l.name, l.kind, t.depth + 1, t.seen || l.id
      from locations l join t on l.id = t.parent_id where not l.id = any(t.seen)
  )
  select coalesce(string_agg(name, ' › ' order by depth desc) filter (where kind <> 'company' or depth = 0), '') from t
$$;

-- Evitar ciclos al cambiar el padre (con bloqueo para serializar cambios concurrentes)
create or replace function locations_no_cycle() returns trigger
language plpgsql as $$
begin
  if new.parent_id is null or (tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('locations:' || new.org_id::text));
  if exists (
    with recursive up(id, parent_id) as (
      select id, parent_id from locations where id = new.parent_id
      union
      select l.id, l.parent_id from locations l join up on l.id = up.parent_id
    ) select 1 from up where id = new.id
  ) then
    raise exception 'Una ubicación no puede colgar de sí misma ni de sus descendientes' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_locations_no_cycle before insert or update of parent_id on locations
  for each row execute function locations_no_cycle();

-- ---------------------------------------------------------------------
-- 8. Resúmenes con bloqueo previo y puntos vinculados a activos
-- ---------------------------------------------------------------------
create or replace function app_refresh_asset_summary(p_asset uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_last record;
  v_unit text; v_count int;
begin
  if p_asset is null then return; end if;
  perform 1 from assets where id = p_asset for update;
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

-- Un punto de tipo «activo» refleja también las mediciones directas de su activo.
create or replace function app_refresh_point_summary(p_point uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_last record; v_asset uuid; v_type text;
begin
  if p_point is null then return; end if;
  select asset_id, point_type into v_asset, v_type from plan_points where id = p_point for update;
  select m.id, m.recorded_at, m.result into v_last
    from measurements m
   where m.status = 'final'
     and (m.plan_point_id = p_point or (v_type = 'asset' and v_asset is not null and m.asset_id = v_asset))
   order by m.recorded_at desc, m.created_at desc limit 1;
  update plan_points set last_measurement_id = v_last.id, last_measured_at = v_last.recorded_at, last_result = v_last.result
   where id = p_point;
end $$;

create or replace function app_refresh_campaign_item(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_last record;
begin
  if p_item is null then return; end if;
  perform 1 from campaign_items where id = p_item for update;
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

-- Orden de bloqueo constante: activo → puntos → elemento de campaña
create or replace function measurements_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if new.status = 'draft' then return new; end if;
  perform app_refresh_asset_summary(new.asset_id);
  if new.plan_point_id is not null then
    perform app_refresh_point_summary(new.plan_point_id);
  end if;
  if new.asset_id is not null then
    for p in select id from plan_points where asset_id = new.asset_id and point_type = 'asset' and archived_at is null
               and id is distinct from new.plan_point_id order by id loop
      perform app_refresh_point_summary(p.id);
    end loop;
  end if;
  perform app_refresh_campaign_item(new.campaign_item_id);
  return new;
end $$;

-- El cambio de periodicidad de una categoría recalcula los activos que la heredan
create or replace function categories_period_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  for a in select id from assets where category_id = new.id and period_unit is null order by id loop
    perform app_refresh_asset_summary(a.id);
  end loop;
  return new;
end $$;
create trigger trg_categories_period after update of period_unit, period_count on categories
  for each row when (old.period_unit is distinct from new.period_unit or old.period_count is distinct from new.period_count)
  execute function categories_period_changed();

-- ---------------------------------------------------------------------
-- 9. Alertas: si el responsable ya no es un miembro activo, avisar a los gestores
-- ---------------------------------------------------------------------
create or replace function app_generate_alert_notifications() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  v_week text := to_char(now(), 'IYYY-IW');
  o record;
  lead_due int; lead_cal int; lead_nc int;
begin
  for o in select id, settings from organizations loop
    lead_due := coalesce((o.settings->>'dueLeadDays')::int, 14);
    lead_cal := coalesce((o.settings->>'calibrationLeadDays')::int, 30);
    lead_nc  := coalesce((o.settings->>'ncLeadDays')::int, 7);

    with active as (
      select m.user_id, r.key as role_key from memberships m join roles r on r.id = m.role_id join users u on u.id = m.user_id
       where m.org_id = o.id and m.is_active and u.is_active
    ),
    raw as (
      select a.owner_user_id as owner, 'measurement_overdue' as kind, 'Medición vencida: ' || a.code as title, a.name as body, '/inventario/' || a.id as link, 'overdue:' || a.id || ':' || v_week as k
        from assets a where a.org_id = o.id and a.archived_at is null and a.status <> 'retired' and a.next_due_at <= now()
      union all
      select a.owner_user_id, 'measurement_due', 'Medición próxima: ' || a.code, a.name || ' · ' || to_char(a.next_due_at, 'DD/MM/YYYY'), '/inventario/' || a.id, 'due:' || a.id || ':' || v_week
        from assets a where a.org_id = o.id and a.archived_at is null and a.status <> 'retired' and a.next_due_at > now() and a.next_due_at <= now() + make_interval(days => lead_due)
      union all
      select i.owner_user_id, case when i.calibration_due_on < current_date or i.calibration_due_on is null then 'calibration_overdue' else 'calibration_due' end,
             case when i.calibration_due_on < current_date or i.calibration_due_on is null then 'Calibración vencida: ' else 'Calibración próxima: ' end || i.code,
             i.type || coalesce(' · vence ' || to_char(i.calibration_due_on, 'DD/MM/YYYY'), ' · sin calibración'), '/instrumentos/' || i.id, 'cal:' || i.id || ':' || v_week
        from instruments i where i.org_id = o.id and i.archived_at is null and i.status <> 'retired' and (i.calibration_due_on is null or i.calibration_due_on <= current_date + lead_cal)
      union all
      select n.owner_user_id, 'nc_due', case when n.due_on < current_date then 'NC fuera de plazo: ' else 'NC próxima a vencer: ' end || n.code, n.title, '/no-conformidades/' || n.id, 'nc:' || n.id || ':' || v_week
        from nonconformities n where n.org_id = o.id and n.status <> 'closed' and n.due_on is not null and n.due_on <= current_date + lead_nc
      union all
      select x.owner_user_id, 'action_overdue', 'Acción vencida en ' || n.code, left(x.description, 200), '/no-conformidades/' || n.id, 'act:' || x.id || ':' || v_week
        from nc_actions x join nonconformities n on n.id = x.nc_id where x.org_id = o.id and x.status = 'open' and x.due_on < current_date
      union all
      select c.owner_user_id, 'campaign_late', 'Campaña atrasada: ' || c.code, c.name, '/campanas/' || c.id, 'camp:' || c.id || ':' || v_week
        from campaigns c where c.org_id = o.id and c.status = 'in_progress' and c.ends_on < current_date
      union all
      select a.owner_user_id, 'asset_blocked', 'Activo bloqueado: ' || a.code, a.name, '/inventario/' || a.id, 'blocked:' || a.id || ':' || v_week
        from assets a where a.org_id = o.id and a.archived_at is null and a.status = 'blocked'
    ),
    recipients as (
      select r.owner as user_id, r.kind, r.title, r.body, r.link, r.k from raw r where r.owner in (select user_id from active)
      union all
      select ac.user_id, r.kind, r.title, r.body, r.link, r.k from raw r join active ac on ac.role_key in ('admin', 'esd_manager')
       where r.owner is null or r.owner not in (select user_id from active)
    ),
    ins as (
      insert into notifications(org_id, user_id, kind, title, body, link, dedupe_key)
      select o.id, user_id, kind, title, body, link, k from recipients
      on conflict do nothing
      returning 1
    )
    select v_count + count(*) into v_count from ins;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 10. EXECUTE: solo lo que la aplicación invoca directamente
-- ---------------------------------------------------------------------
revoke execute on function app_refresh_asset_summary(uuid), app_refresh_point_summary(uuid), app_refresh_campaign_item(uuid),
  measurements_after_change(), assets_period_changed(), categories_period_changed(), app_check_refs(),
  campaign_technicians_member(), floor_plans_current_version(), no_closed_on_insert(), measurement_values_insert_guard(),
  locations_no_cycle(), criterion_versions_guard(), measurements_guard(), measurement_values_guard(), audit_log_guard(),
  campaigns_guard(), nonconformities_guard(), plan_points_guard(), touch_updated_at()
  from public, esd_app;
revoke execute on function app_generate_alert_notifications() from public;
grant execute on function app_generate_alert_notifications() to esd_app;
grant execute on function app_auth_set_password(uuid, text), app_session_revoke_user(uuid), app_location_subtree(uuid), app_location_path(uuid) to esd_app;
