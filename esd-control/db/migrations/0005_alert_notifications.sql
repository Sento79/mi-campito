-- =====================================================================
-- 0005: generación de notificaciones de alertas (idempotente).
-- La ejecuta una tarea programada (POST /api/cron/alerts o
-- `npm run jobs:alerts`). SECURITY DEFINER: recorre todas las
-- organizaciones; solo inserta notificaciones a miembros activos.
-- Deduplicación semanal por (usuario, clave): no se repiten avisos.
-- =====================================================================
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

    with managers as (
      select m.user_id from memberships m join roles r on r.id = m.role_id join users u on u.id = m.user_id
       where m.org_id = o.id and m.is_active and u.is_active and r.key in ('admin','esd_manager')
    ),
    alerts as (
      -- Mediciones vencidas
      select coalesce(a.owner_user_id, mg.user_id) as user_id, 'measurement_overdue' as kind,
             'Medición vencida: ' || a.code as title, a.name as body, '/inventario/' || a.id as link, 'overdue:' || a.id || ':' || v_week as k
        from assets a join categories c on c.id = a.category_id
        left join managers mg on a.owner_user_id is null
       where a.org_id = o.id and a.archived_at is null and a.status <> 'retired' and a.next_due_at <= now()
      union all
      -- Mediciones próximas
      select coalesce(a.owner_user_id, mg.user_id), 'measurement_due', 'Medición próxima: ' || a.code, a.name || ' · ' || to_char(a.next_due_at, 'DD/MM/YYYY'), '/inventario/' || a.id, 'due:' || a.id || ':' || v_week
        from assets a left join managers mg on a.owner_user_id is null
       where a.org_id = o.id and a.archived_at is null and a.status <> 'retired' and a.next_due_at > now() and a.next_due_at <= now() + make_interval(days => lead_due)
      union all
      -- Calibración vencida / próxima
      select coalesce(i.owner_user_id, mg.user_id), case when i.calibration_due_on < current_date or i.calibration_due_on is null then 'calibration_overdue' else 'calibration_due' end,
             case when i.calibration_due_on < current_date or i.calibration_due_on is null then 'Calibración vencida: ' else 'Calibración próxima: ' end || i.code,
             i.type || coalesce(' · vence ' || to_char(i.calibration_due_on, 'DD/MM/YYYY'), ' · sin calibración'), '/instrumentos/' || i.id, 'cal:' || i.id || ':' || v_week
        from instruments i left join managers mg on i.owner_user_id is null
       where i.org_id = o.id and i.archived_at is null and i.status <> 'retired' and (i.calibration_due_on is null or i.calibration_due_on <= current_date + lead_cal)
      union all
      -- NC fuera de plazo o próximas
      select coalesce(n.owner_user_id, mg.user_id), 'nc_due', case when n.due_on < current_date then 'NC fuera de plazo: ' else 'NC próxima a vencer: ' end || n.code, n.title, '/no-conformidades/' || n.id, 'nc:' || n.id || ':' || v_week
        from nonconformities n left join managers mg on n.owner_user_id is null
       where n.org_id = o.id and n.status <> 'closed' and n.due_on is not null and n.due_on <= current_date + lead_nc
      union all
      -- Acciones correctivas vencidas
      select coalesce(x.owner_user_id, mg.user_id), 'action_overdue', 'Acción vencida en ' || n.code, left(x.description, 200), '/no-conformidades/' || n.id, 'act:' || x.id || ':' || v_week
        from nc_actions x join nonconformities n on n.id = x.nc_id left join managers mg on x.owner_user_id is null
       where x.org_id = o.id and x.status = 'open' and x.due_on < current_date
      union all
      -- Campañas atrasadas
      select coalesce(c.owner_user_id, mg.user_id), 'campaign_late', 'Campaña atrasada: ' || c.code, c.name, '/campanas/' || c.id, 'camp:' || c.id || ':' || v_week
        from campaigns c left join managers mg on c.owner_user_id is null
       where c.org_id = o.id and c.status = 'in_progress' and c.ends_on < current_date
      union all
      -- Activos bloqueados
      select coalesce(a.owner_user_id, mg.user_id), 'asset_blocked', 'Activo bloqueado: ' || a.code, a.name, '/inventario/' || a.id, 'blocked:' || a.id || ':' || v_week
        from assets a left join managers mg on a.owner_user_id is null
       where a.org_id = o.id and a.archived_at is null and a.status = 'blocked'
    ),
    ins as (
      insert into notifications(org_id, user_id, kind, title, body, link, dedupe_key)
      select o.id, al.user_id, al.kind, al.title, al.body, al.link, al.k
        from alerts al
       where al.user_id is not null
         and exists (select 1 from memberships m where m.org_id = o.id and m.user_id = al.user_id and m.is_active)
      on conflict do nothing
      returning 1
    )
    select v_count + count(*) into v_count from ins;
  end loop;
  return v_count;
end $$;

revoke all on function app_generate_alert_notifications() from public;
grant execute on function app_generate_alert_notifications() to esd_app;
