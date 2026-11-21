import "server-only";
import type { Row as DbRow } from "postgres";
import type { Tx } from "@/lib/server/db";
import { categoryOptions, locationOptions, userOptions } from "@/lib/server/queries/common";

export async function assetFormOptions(tx: Tx) {
  const [categories, locations, users, criteria, templates] = await Promise.all([
    categoryOptions(tx),
    locationOptions(tx),
    userOptions(tx),
    tx`select id, code || ' · ' || name as label from criteria where is_active order by code`,
    tx`select id, name as label from point_templates where is_active order by name`,
  ]);
  return {
    categories,
    locations,
    users,
    criteria: criteria.map((c) => ({ id: c.id as string, label: c.label as string })),
    templates: templates.map((c) => ({ id: c.id as string, label: c.label as string })),
  };
}

export function assetToForm(a: DbRow) {
  return {
    code: a.code,
    scanCode: a.scan_code === a.code ? "" : a.scan_code,
    name: a.name,
    categoryId: a.category_id,
    manufacturer: a.manufacturer ?? "",
    model: a.model ?? "",
    serialNumber: a.serial_number ?? "",
    locationId: a.location_id ?? "",
    commissionedOn: a.commissioned_on,
    status: a.status,
    ownerUserId: a.owner_user_id ?? "",
    periodUnit: a.period_unit ?? "",
    periodCount: a.period_count ? String(a.period_count) : "",
    criterionId: a.criterion_id ?? "",
    pointTemplateId: a.point_template_id ?? "",
    notes: a.notes ?? "",
    reason: "",
  };
}
