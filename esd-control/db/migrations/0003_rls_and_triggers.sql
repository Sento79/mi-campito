-- =====================================================================
-- 0003: Row Level Security, permisos y disparadores de integridad.
-- El rol esd_app lo crea el script de migración antes de aplicar este
-- archivo (scripts/migrate.ts) con la contraseña de APP_DB_PASSWORD.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funciones auxiliares SECURITY DEFINER
-- ---------------------------------------------------------------------
create or replace function app_user_in_org(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where user_id = p_user and org_id = app_current_org())
$$;

-- El contador se protege: no hay permisos directos sobre org_counters.
alter function app_next_counter(text) security definer;
alter function app_next_counter(text) set search_path = public;

-- Intervalo de periodicidad. Postgres recorta fin de mes (31-ene + 1 mes = 28/29-feb);
-- src/lib/domain/periodicity.ts replica exactamente esta regla.
create or replace function app_period_interval(p_unit text, p_count integer) returns interval
language sql immutable as $$
  select case p_unit
    when 'day'      then make_interval(days => p_count)
    when 'week'     then make_interval(weeks => p_count)
    when 'month'    then make_interval(months => p_count)
    when 'quarter'  then make_interval(months => 3 * p_count)
    when 'semester' then make_interval(months => 6 * p_count)
    when 'year'     then make_interval(years => p_count)
    else null end
$$;

-- ---------------------------------------------------------------------
-- Resumen de última medición en activos, puntos y elementos de campaña.
-- Se ejecuta como propietario para que el técnico no necesite permiso
-- de edición sobre activos.
-- ---------------------------------------------------------------------
create or replace function app_refresh_asset_summary(p_asset uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_last record;
  v_unit text; v_count int;
begin
  if p_asset is null then return; end if;
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
      else v_last.recorded_at  -- no conforme / incompleto / revisión: vence ya, requiere nueva medición
    end
  where id = p_asset;
end $$;

create or replace function app_refresh_point_summary(p_point uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_last record;
begin
  if p_point is null then return; end if;
  select m.id, m.recorded_at, m.result into v_last
    from measurements m where m.plan_point_id = p_point and m.status = 'final'
   order by m.recorded_at desc, m.created_at desc limit 1;
  update plan_points set last_measurement_id = v_last.id, last_measured_at = v_last.recorded_at, last_result = v_last.result
   where id = p_point;
end $$;

create or replace function app_refresh_campaign_item(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_last record;
begin
  if p_item is null then return; end if;
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

create or replace function measurements_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'draft' then return new; end if;
  perform app_refresh_asset_summary(new.asset_id);
  perform app_refresh_point_summary(new.plan_point_id);
  perform app_refresh_campaign_item(new.campaign_item_id);
  return new;
end $$;
create trigger trg_measurements_after after insert or update on measurements
  for each row execute function measurements_after_change();

-- Recalcular vencimiento si cambia la periodicidad del activo.
create or replace function assets_period_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app_refresh_asset_summary(new.id);
  return new;
end $$;
create trigger trg_assets_period after update of period_unit, period_count, category_id on assets
  for each row execute function assets_period_changed();

-- ---------------------------------------------------------------------
-- Reglas de negocio reforzadas en base de datos
-- ---------------------------------------------------------------------

-- Cierre de campaña requiere permiso 'campaign.close'; una campaña cerrada o cancelada
-- no se reabre ni se modifica.
create or replace function campaigns_guard() returns trigger
language plpgsql as $$
begin
  if old.status in ('closed','cancelled') then
    raise exception 'La campaña está % y no admite cambios', old.status using errcode = '42501';
  end if;
  if new.status = 'closed' and old.status <> 'closed' then
    if not app_has_permission('campaign.close') then
      raise exception 'Se requiere el permiso de cierre de campaña' using errcode = '42501';
    end if;
    if new.closed_by is null or new.closed_at is null then
      raise exception 'El cierre debe registrar responsable y fecha' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger trg_campaigns_guard before update on campaigns for each row execute function campaigns_guard();

-- El cierre de una NC requiere permiso de validación.
create or replace function nonconformities_guard() returns trigger
language plpgsql as $$
begin
  if new.status = 'closed' and old.status <> 'closed' and not app_has_permission('validate') then
    raise exception 'Se requiere el permiso de validación para cerrar' using errcode = '42501';
  end if;
  if old.status = 'closed' and new.status not in ('closed','reopened') then
    raise exception 'Una NC cerrada solo puede reabrirse' using errcode = '42501';
  end if;
  if old.status = 'closed' and new.status = 'closed' and to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at' then
    raise exception 'Una NC cerrada no se puede editar; reábrala' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_nonconformities_guard before update on nonconformities for each row execute function nonconformities_guard();

-- Protección del plano durante campañas en curso: mover/archivar/crear puntos
-- requiere una anulación explícita (app.layout_override = 'on'), que la
-- aplicación solo fija tras confirmación con motivo (y queda en auditoría).
create or replace function plan_points_guard() returns trigger
language plpgsql as $$
declare v_plan uuid := coalesce(new.plan_id, old.plan_id);
begin
  if tg_op = 'UPDATE' and new.x = old.x and new.y = old.y and new.page_number = old.page_number
     and new.archived_at is not distinct from old.archived_at then
    return new;
  end if;
  if exists (select 1 from campaigns c where c.plan_id = v_plan and c.status = 'in_progress')
     and coalesce(current_setting('app.layout_override', true), 'off') <> 'on' then
    raise exception 'El plano tiene una campaña en curso: los cambios de disposición requieren confirmación' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_plan_points_guard before insert or update on plan_points for each row execute function plan_points_guard();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
create or replace function app_any_permission(variadic p_keys text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
      join role_permissions rp on rp.role_id = m.role_id
      join users u on u.id = m.user_id
     where m.user_id = app_current_user() and m.org_id = app_current_org()
       and m.is_active and u.is_active and rp.permission_key = any(p_keys))
$$;

do $$
declare
  t record;
begin
  -- tabla, permisos de inserción, permisos de actualización, permisos de borrado (null = sin borrado)
  for t in select * from (values
    ('locations',            array['create','settings.manage'],   array['edit','settings.manage'],      null::text[]),
    ('documents',            array['create','edit','measure','instruments.manage','criteria.manage','settings.manage'], array['edit'], null),
    ('procedures',           array['criteria.manage'],            array['criteria.manage'],             null),
    ('criteria',             array['criteria.manage'],            array['criteria.manage'],             null),
    ('criterion_versions',   array['criteria.manage'],            array['criteria.manage'],             array['criteria.manage']),
    ('categories',           array['criteria.manage'],            array['criteria.manage'],             null),
    ('point_templates',      array['criteria.manage'],            array['criteria.manage'],             null),
    ('point_template_items', array['criteria.manage'],            array['criteria.manage'],             array['criteria.manage']),
    ('assets',               array['create'],                     array['edit'],                        null),
    ('instruments',          array['instruments.manage'],         array['instruments.manage'],          null),
    ('calibrations',         array['instruments.manage'],         array['instruments.manage'],          null),
    ('floor_plans',          array['create'],                     array['edit'],                        null),
    ('floor_plan_versions',  array['create','edit'],              array['edit'],                        null),
    ('floor_plan_pages',     array['create','edit'],              array['edit'],                        null),
    ('plan_points',          array['create','edit'],              array['edit'],                        null),
    ('campaigns',            array['create'],                     array['edit','campaign.close'],       null),
    ('campaign_technicians', array['create','edit'],              array['edit'],                        array['create','edit']),
    ('campaign_categories',  array['create','edit'],              array['edit'],                        array['create','edit']),
    ('campaign_items',       array['create','edit'],              array['edit'],                        array['create','edit']),
    ('nc_severities',        array['settings.manage'],            array['settings.manage'],             null),
    ('nonconformities',      array['create','measure'],           array['edit','validate'],             null),
    ('nc_links',             array['create','measure','edit'],    array['edit'],                        null),
    ('nc_actions',           array['create','edit','validate'],   array['edit','validate'],             null),
    ('nc_status_history',    array['create','edit','validate','measure'], array[]::text[],             null),
    ('label_templates',      array['create','edit'],              array['edit'],                        array['edit']),
    ('role_permissions',     array['users.manage'],               array['users.manage'],                array['users.manage'])
  ) as v(tbl, ins, upd, del)
  loop
    execute format('alter table %I enable row level security', t.tbl);
    execute format('create policy %I on %I for select using (org_id = app_current_org() and app_is_member())', t.tbl || '_sel', t.tbl);
    execute format('create policy %I on %I for insert with check (org_id = app_current_org() and app_any_permission(variadic %L::text[]))', t.tbl || '_ins', t.tbl, t.ins);
    if cardinality(t.upd) > 0 then
      execute format('create policy %I on %I for update using (org_id = app_current_org() and app_any_permission(variadic %L::text[])) with check (org_id = app_current_org())', t.tbl || '_upd', t.tbl, t.upd);
    end if;
    if t.del is not null then
      execute format('create policy %I on %I for delete using (org_id = app_current_org() and app_any_permission(variadic %L::text[]))', t.tbl || '_del', t.tbl, t.del);
    end if;
  end loop;
end $$;

-- Organizaciones: solo la propia; edición de configuración con settings.manage.
alter table organizations enable row level security;
create policy organizations_sel on organizations for select using (id = app_current_org() and app_is_member());
create policy organizations_upd on organizations for update using (id = app_current_org() and app_has_permission('settings.manage')) with check (id = app_current_org());

-- Usuarios: visibles los miembros de la organización actual.
alter table users enable row level security;
create policy users_sel on users for select using (id = app_current_user() or app_user_in_org(id));
create policy users_upd on users for update using (id = app_current_user() or (app_user_in_org(id) and app_has_permission('users.manage')));

-- Roles y pertenencias.
alter table roles enable row level security;
create policy roles_sel on roles for select using (org_id = app_current_org() and app_is_member());
create policy roles_ins on roles for insert with check (org_id = app_current_org() and app_has_permission('users.manage'));
create policy roles_upd on roles for update using (org_id = app_current_org() and app_has_permission('users.manage') and not is_system);
create policy roles_del on roles for delete using (org_id = app_current_org() and app_has_permission('users.manage') and not is_system);

alter table memberships enable row level security;
create policy memberships_sel on memberships for select using (org_id = app_current_org() and app_is_member());
create policy memberships_upd on memberships for update using (org_id = app_current_org() and app_has_permission('users.manage')) with check (org_id = app_current_org());

alter table permissions enable row level security;
create policy permissions_sel on permissions for select using (true);

-- Mediciones: inserción por técnicos (en su propio nombre); invalidación con 'validate';
-- borradores editables/borrables solo por su autor.
alter table measurements enable row level security;
create policy measurements_sel on measurements for select using (org_id = app_current_org() and app_is_member());
create policy measurements_ins on measurements for insert with check (org_id = app_current_org() and measured_by = app_current_user() and app_has_permission('measure'));
create policy measurements_upd on measurements for update using (
  org_id = app_current_org() and (
    app_has_permission('validate') or (status = 'draft' and measured_by = app_current_user())
  )) with check (org_id = app_current_org());
create policy measurements_del on measurements for delete using (org_id = app_current_org() and status = 'draft' and measured_by = app_current_user());

alter table measurement_values enable row level security;
create policy measurement_values_sel on measurement_values for select using (org_id = app_current_org() and app_is_member());
create policy measurement_values_ins on measurement_values for insert with check (org_id = app_current_org() and app_has_permission('measure'));
create policy measurement_values_del on measurement_values for delete using (org_id = app_current_org() and exists (
  select 1 from measurements m where m.id = measurement_id and m.status = 'draft' and m.measured_by = app_current_user()));

-- Auditoría: lectura con 'audit.read'; inserción por cualquier miembro en su nombre.
alter table audit_log enable row level security;
create policy audit_sel on audit_log for select using (org_id = app_current_org() and app_has_permission('audit.read'));
create policy audit_ins on audit_log for insert with check (org_id = app_current_org() and app_is_member() and (user_id is null or user_id = app_current_user()));
alter table audit_log_archive enable row level security;
create policy audit_archive_sel on audit_log_archive for select using (org_id = app_current_org() and app_has_permission('audit.read'));

-- Notificaciones: cada usuario ve las suyas; la app puede generarlas para miembros.
alter table notifications enable row level security;
create policy notifications_sel on notifications for select using (org_id = app_current_org() and user_id = app_current_user());
create policy notifications_ins on notifications for insert with check (org_id = app_current_org() and app_is_member() and app_user_in_org(user_id));
create policy notifications_upd on notifications for update using (org_id = app_current_org() and user_id = app_current_user());
create policy notifications_del on notifications for delete using (org_id = app_current_org() and user_id = app_current_user());

-- Tablas sin acceso directo para la aplicación.
alter table sessions enable row level security;
alter table org_counters enable row level security;

-- ---------------------------------------------------------------------
-- Permisos del rol de aplicación
-- ---------------------------------------------------------------------
grant usage on schema public to esd_app;
grant select, insert, update on all tables in schema public to esd_app;
revoke all on sessions, org_counters from esd_app;
revoke insert, update, delete on audit_log_archive from esd_app;
revoke update, delete on audit_log from esd_app;
revoke insert, update on permissions from esd_app;
revoke insert, update on users from esd_app;
grant update (full_name, is_active) on users to esd_app;
grant delete on measurements, measurement_values, role_permissions, campaign_technicians, campaign_categories,
  campaign_items, notifications, point_template_items, roles, label_templates, criterion_versions to esd_app;
grant usage, select on all sequences in schema public to esd_app;
grant execute on all functions in schema public to esd_app;
revoke execute on function audit_archive_before(timestamptz) from esd_app;
