import "server-only";
import type { Tx } from "../db";

export interface DashboardFilters {
  locationId?: string;
  categoryId?: string;
  campaignId?: string;
  from: string; // AAAA-MM-DD
  to: string; // AAAA-MM-DD inclusive
}

export async function loadDashboard(tx: Tx, f: DashboardFilters, leadDays: number, calLeadDays: number) {
  const toExcl = new Date(Date.parse(f.to + "T00:00:00Z") + 86400000).toISOString();
  const fromTs = f.from + "T00:00:00Z";
  const assetScope = tx`
    a.archived_at is null and a.status <> 'retired'
    ${f.locationId ? tx`and a.location_id in (select app_location_subtree(${f.locationId}))` : tx``}
    ${f.categoryId ? tx`and a.category_id = ${f.categoryId}` : tx``}
    ${f.campaignId ? tx`and a.id in (select asset_id from campaign_items where campaign_id = ${f.campaignId} and asset_id is not null)` : tx``}`;
  const mScope = tx`
    m.status = 'final' and m.recorded_at >= ${fromTs} and m.recorded_at < ${toExcl}
    ${f.locationId ? tx`and (m.asset_id in (select id from assets where location_id in (select app_location_subtree(${f.locationId}))) or m.plan_point_id in (select id from plan_points where location_id in (select app_location_subtree(${f.locationId}))))` : tx``}
    ${f.categoryId ? tx`and m.category_id = ${f.categoryId}` : tx``}
    ${f.campaignId ? tx`and m.campaign_id = ${f.campaignId}` : tx``}`;

  const [assets] = await tx`
    select count(*)::int as total,
      count(*) filter (where coalesce(a.period_unit, c.period_unit) is not null)::int as scheduled,
      count(*) filter (where a.next_due_at is not null and a.next_due_at <= now())::int as overdue,
      count(*) filter (where a.next_due_at > now() and a.next_due_at <= now() + make_interval(days => ${leadDays}))::int as due_soon,
      count(*) filter (where a.last_measured_at is null and coalesce(a.period_unit, c.period_unit) is not null)::int as never_measured,
      count(*) filter (where a.next_due_at >= ${fromTs} and a.next_due_at < ${toExcl})::int as planned_in_period,
      count(*) filter (where coalesce(a.period_unit, c.period_unit) is not null and a.last_result = 'pass' and a.next_due_at > now())::int as compliant,
      count(*) filter (where a.status = 'blocked')::int as blocked
    from assets a join categories c on c.id = a.category_id where ${assetScope}`;

  const [meas] = await tx`
    select count(*)::int as total,
      count(*) filter (where result = 'pass')::int as pass,
      count(*) filter (where result = 'fail')::int as fail,
      count(*) filter (where result in ('review','incomplete'))::int as review,
      count(*) filter (where result in ('not_measurable','not_applicable'))::int as nm
    from measurements m where ${mScope}`;

  const trend = await tx`
    select to_char(date_trunc('week', m.recorded_at), 'YYYY-MM-DD') as week,
      count(*) filter (where result = 'pass')::int as pass,
      count(*) filter (where result = 'fail')::int as fail,
      count(*) filter (where result not in ('pass','fail'))::int as other
    from measurements m where ${mScope} group by 1 order by 1`;

  const byCategory = await tx`
    select c.name, count(*)::int as total,
      count(*) filter (where a.last_result = 'pass')::int as pass,
      count(*) filter (where a.last_result = 'fail')::int as fail,
      count(*) filter (where a.last_result is not null and a.last_result not in ('pass','fail'))::int as other,
      count(*) filter (where a.last_result is null)::int as none
    from assets a join categories c on c.id = a.category_id where ${assetScope}
    group by c.name order by total desc limit 10`;

  const [campaigns] = await tx`select count(*) filter (where status = 'in_progress')::int as active,
      count(*) filter (where status = 'in_progress' and ends_on < current_date)::int as late from campaigns`;
  const [ncs] = await tx`select count(*) filter (where status <> 'closed')::int as open,
      count(*) filter (where status <> 'closed' and due_on < current_date)::int as overdue from nonconformities`;
  const [instruments] = await tx`select
      count(*) filter (where calibration_due_on < current_date or calibration_due_on is null)::int as expired,
      count(*) filter (where calibration_due_on >= current_date and calibration_due_on <= current_date + ${calLeadDays}::int)::int as due_soon
    from instruments where archived_at is null and status <> 'retired'`;

  const recent = await tx`
    select m.id, m.result, m.recorded_at, u.full_name as by_name,
      coalesce(a.code || ' · ' || a.name, 'Punto ' || pp.code || ' · ' || fp.title) as target
    from measurements m join users u on u.id = m.measured_by
      left join assets a on a.id = m.asset_id
      left join plan_points pp on pp.id = m.plan_point_id left join floor_plans fp on fp.id = pp.plan_id
    order by m.recorded_at desc limit 8`;

  const upcoming = await tx`
    (select 'asset' as kind, a.id, a.code || ' · ' || a.name as title, a.next_due_at as due, 'Medición' as what
       from assets a join categories c on c.id = a.category_id where ${assetScope} and a.next_due_at is not null and a.next_due_at <= now() + make_interval(days => ${leadDays})
       order by a.next_due_at limit 6)
    union all
    (select 'instrument', id, code || ' · ' || type, calibration_due_on::timestamptz, 'Calibración'
       from instruments where archived_at is null and status <> 'retired' and calibration_due_on <= current_date + ${calLeadDays}::int order by calibration_due_on limit 4)
    union all
    (select 'nc', id, code || ' · ' || title, due_on::timestamptz, 'No conformidad'
       from nonconformities where status <> 'closed' and due_on is not null and due_on <= current_date + 14 order by due_on limit 4)
    union all
    (select 'campaign', id, name, ends_on::timestamptz, 'Fin de campaña'
       from campaigns where status = 'in_progress' order by ends_on limit 3)
    order by due nulls last limit 12`;

  const scheduled = assets.scheduled || 0;
  return {
    assets,
    meas,
    trend,
    byCategory,
    campaigns,
    ncs,
    instruments,
    recent,
    upcoming,
    compliancePct: scheduled ? Math.round((assets.compliant / scheduled) * 1000) / 10 : null,
  };
}
