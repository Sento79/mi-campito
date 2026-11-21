import "server-only";
import type { Tx } from "../db";
import { dateOrUndef, likePattern, str, uuidOrUndef } from "./common";
import { ASSET_STATUSES } from "@/lib/domain/asset-import";
import { AppError } from "../errors";

export type SP = Record<string, string | string[] | undefined>;

/** Construye el filtro de activos a partir de parámetros de URL (listado y exportación). */
export function assetWhere(tx: Tx, sp: SP, leadDays: number) {
  const q = str(sp.q);
  const category = uuidOrUndef(sp.category);
  const location = uuidOrUndef(sp.location);
  const status = str(sp.status);
  const due = str(sp.due);
  const result = str(sp.result);
  const archived = str(sp.archived) === "1";
  const from = dateOrUndef(sp.from);
  const to = dateOrUndef(sp.to);
  const rawIds = Array.isArray(sp.ids) ? sp.ids.join(",") : sp.ids;
  const ids = rawIds ? rawIds.split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)) : undefined;
  if (ids && ids.length > 5000) throw new AppError("Demasiados activos seleccionados (máx. 5000)", 400);
  return tx`
    ${archived ? tx`a.archived_at is not null` : tx`a.archived_at is null`}
    ${ids?.length ? tx`and a.id = any(${ids})` : tx``}
    ${q ? tx`and (a.code ilike ${likePattern(q)} or a.name ilike ${likePattern(q)} or a.serial_number ilike ${likePattern(q)} or a.scan_code ilike ${likePattern(q)})` : tx``}
    ${category ? tx`and a.category_id = ${category}` : tx``}
    ${location ? tx`and a.location_id in (select app_location_subtree(${location}))` : tx``}
    ${status && (ASSET_STATUSES as readonly string[]).includes(status) ? tx`and a.status = ${status}` : tx``}
    ${result === "none" ? tx`and a.last_result is null` : result ? tx`and a.last_result = ${result}` : tx``}
    ${due === "overdue" ? tx`and a.next_due_at <= now()` : tx``}
    ${due === "soon" ? tx`and a.next_due_at > now() and a.next_due_at <= now() + make_interval(days => ${leadDays})` : tx``}
    ${due === "never" ? tx`and a.last_measured_at is null` : tx``}
    ${due === "period" && from && to ? tx`and a.next_due_at >= ${from + "T00:00:00Z"} and a.next_due_at < (${to}::date + 1)` : tx``}`;
}
