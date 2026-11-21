import "server-only";
import type { Tx } from "../db";
import { dateOrUndef, likePattern, str, uuidOrUndef } from "./common";
import { RESULTS } from "@/lib/domain/results";

export type SP = Record<string, string | string[] | undefined>;

export function measurementWhere(tx: Tx, sp: SP) {
  const q = str(sp.q);
  const result = str(sp.result);
  const from = dateOrUndef(sp.from);
  const to = dateOrUndef(sp.to);
  const category = uuidOrUndef(sp.category);
  const location = uuidOrUndef(sp.location);
  const campaign = uuidOrUndef(sp.campaign);
  const user = uuidOrUndef(sp.user);
  const asset = uuidOrUndef(sp.asset);
  const status = str(sp.status);
  return tx`true
    ${status === "invalidated" ? tx`and m.status = 'invalidated'` : status === "all" ? tx`` : tx`and m.status = 'final'`}
    ${result && (RESULTS as readonly string[]).includes(result) ? tx`and m.result = ${result}` : tx``}
    ${from ? tx`and m.recorded_at >= ${from + "T00:00:00Z"}` : tx``}
    ${to ? tx`and m.recorded_at < (${to}::date + 1)` : tx``}
    ${category ? tx`and m.category_id = ${category}` : tx``}
    ${campaign ? tx`and m.campaign_id = ${campaign}` : tx``}
    ${user ? tx`and m.measured_by = ${user}` : tx``}
    ${asset ? tx`and m.asset_id = ${asset}` : tx``}
    ${location ? tx`and (a.location_id in (select app_location_subtree(${location})) or pp.location_id in (select app_location_subtree(${location})))` : tx``}
    ${q ? tx`and (a.code ilike ${likePattern(q)} or a.name ilike ${likePattern(q)} or pp.code ilike ${likePattern(q)} or pp.name ilike ${likePattern(q)})` : tx``}`;
}

