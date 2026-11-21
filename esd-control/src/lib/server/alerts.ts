import "server-only";
import type { Tx } from "./db";
import type { OrgSettings } from "@/lib/domain/settings";

export type AlertKind = "measurement_overdue" | "measurement_due" | "incomplete" | "asset_blocked" | "calibration_overdue" | "calibration_due" | "nc_overdue" | "nc_open" | "action_overdue" | "campaign_late";

export const ALERT_LABEL: Record<AlertKind, string> = {
  measurement_overdue: "Medición vencida",
  measurement_due: "Medición próxima",
  incomplete: "Medición incompleta / en revisión",
  asset_blocked: "Activo bloqueado",
  calibration_overdue: "Calibración vencida",
  calibration_due: "Calibración próxima",
  nc_overdue: "NC fuera de plazo",
  nc_open: "No conformidad abierta",
  action_overdue: "Acción correctiva vencida",
  campaign_late: "Campaña atrasada",
};
export const ALERT_SEVERITY: Record<AlertKind, "bad" | "warn" | "neutral"> = {
  measurement_overdue: "bad", calibration_overdue: "bad", nc_overdue: "bad", action_overdue: "bad", asset_blocked: "bad",
  measurement_due: "warn", calibration_due: "warn", campaign_late: "warn", incomplete: "warn", nc_open: "neutral",
};

export interface AlertItem { kind: AlertKind; id: string; title: string; detail: string; link: string; date: string | null; owner: string | null }

/** Alertas calculadas en vivo a partir de los datos (no dependen del cron). */
export async function computeAlerts(tx: Tx, st: OrgSettings): Promise<AlertItem[]> {
  const rows = await tx`
    select 'measurement_overdue' as kind, a.id, a.code || ' · ' || a.name as title, c.name as detail, '/inventario/' || a.id as link, a.next_due_at::date::text as date, u.full_name as owner
      from assets a join categories c on c.id = a.category_id left join users u on u.id = a.owner_user_id
     where a.archived_at is null and a.status <> 'retired' and a.next_due_at <= now()
    union all
    select 'measurement_due', a.id, a.code || ' · ' || a.name, c.name, '/inventario/' || a.id, a.next_due_at::date::text, u.full_name
      from assets a join categories c on c.id = a.category_id left join users u on u.id = a.owner_user_id
     where a.archived_at is null and a.status <> 'retired' and a.next_due_at > now() and a.next_due_at <= now() + make_interval(days => ${st.dueLeadDays})
    union all
    select 'incomplete', a.id, a.code || ' · ' || a.name, case a.last_result when 'review' then 'Requiere revisión' else 'Incompleta' end, '/inventario/' || a.id, a.last_measured_at::date::text, u.full_name
      from assets a left join users u on u.id = a.owner_user_id where a.archived_at is null and a.last_result in ('incomplete','review')
    union all
    select 'asset_blocked', a.id, a.code || ' · ' || a.name, 'Bloqueado', '/inventario/' || a.id, null, u.full_name
      from assets a left join users u on u.id = a.owner_user_id where a.archived_at is null and a.status = 'blocked'
    union all
    select case when i.calibration_due_on is null or i.calibration_due_on < current_date then 'calibration_overdue' else 'calibration_due' end, i.id, i.code || ' · ' || i.type,
           coalesce('Vence ' || to_char(i.calibration_due_on, 'DD/MM/YYYY'), 'Sin calibración registrada'), '/instrumentos/' || i.id, i.calibration_due_on::text, u.full_name
      from instruments i left join users u on u.id = i.owner_user_id
     where i.archived_at is null and i.status <> 'retired' and (i.calibration_due_on is null or i.calibration_due_on <= current_date + ${st.calibrationLeadDays}::int)
    union all
    select case when n.due_on < current_date then 'nc_overdue' else 'nc_open' end, n.id, n.code || ' · ' || n.title, 'Estado: ' || n.status, '/no-conformidades/' || n.id, n.due_on::text, u.full_name
      from nonconformities n left join users u on u.id = n.owner_user_id where n.status <> 'closed'
    union all
    select 'action_overdue', x.id, n.code || ' · ' || left(x.description, 120), 'Acción ' || x.kind, '/no-conformidades/' || n.id, x.due_on::text, u.full_name
      from nc_actions x join nonconformities n on n.id = x.nc_id left join users u on u.id = x.owner_user_id where x.status = 'open' and x.due_on < current_date
    union all
    select 'campaign_late', c.id, c.code || ' · ' || c.name, 'Fin previsto ' || to_char(c.ends_on, 'DD/MM/YYYY'), '/campanas/' || c.id, c.ends_on::text, u.full_name
      from campaigns c left join users u on u.id = c.owner_user_id where c.status = 'in_progress' and c.ends_on < current_date
    order by 6 nulls last`;
  return rows as unknown as AlertItem[];
}
