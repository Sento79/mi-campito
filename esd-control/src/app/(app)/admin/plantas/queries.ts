import "server-only";
import type { Tx } from "@/lib/server/db";

export async function loadLocations(tx: Tx) {
  return tx`
    select l.id, l.parent_id, l.kind, l.code, l.name, l.description, l.is_active,
      (select count(*)::int from assets a where a.location_id = l.id and a.archived_at is null) as assets,
      (select count(*)::int from assets a where a.archived_at is null and a.location_id in (select app_location_subtree(l.id))) as total_assets
    from locations l order by l.name`;
}
