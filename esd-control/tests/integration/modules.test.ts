import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { app, as, makeCriterion, makeOrg, owner, type Fixture } from "./helpers";
import { dbTestsEnabled } from "./env";
import { commitImport, previewImport } from "../../src/lib/server/services/assets";
import { createCampaign, transitionCampaign, campaignSummary } from "../../src/lib/server/services/campaigns";
import { recordMeasurement } from "../../src/lib/server/services/measurements";
import { buildReport } from "../../src/lib/server/reports";
import { labelsPdf, labelData } from "../../src/lib/server/labels";
import { orgSettingsSchema } from "../../src/lib/domain/settings";
import { DEFAULT_LABEL_LAYOUT, labelLayoutSchema } from "../../src/lib/domain/labels";
import type { SessionInfo } from "../../src/lib/server/auth";

const d = dbTestsEnabled() ? describe : describe.skip;
let o: postgres.Sql;
let a: postgres.Sql;
let F: Fixture;
const settings = orgSettingsSchema.parse({});

function fakeSession(ctx: { orgId: string; userId: string }, perms: string[]): SessionInfo {
  return {
    ...ctx,
    sessionId: randomUUID(),
    user: { id: ctx.userId, email: "x@test.local", fullName: "Tester" },
    org: { id: ctx.orgId, name: "Org test", isDemo: false, settings },
    role: { key: "esd_manager", name: "Responsable ESD" },
    permissions: new Set(perms),
    orgs: [],
  };
}

beforeAll(async () => {
  if (!dbTestsEnabled()) return;
  o = owner();
  a = app();
  F = await makeOrg(o, "mod");
  await as(a, F.admin, (tx) => tx`insert into locations(org_id, kind, code, name) values (${F.orgId}, 'line', 'L1', 'Línea 1')`);
});
afterAll(async () => {
  await a?.end();
  await o?.end();
});

d("Importación de activos", () => {
  const header = ["codigo", "nombre", "categoria", "ubicacion"];
  it("importa todas las filas válidas en una transacción", async () => {
    const rows = [header, ["IMP-1", "Tapete 1", "TAP", "L1"], ["IMP-2", "Silla 2", "sil", ""]];
    const n = await as(a, F.manager, (tx) => commitImport(tx, F.manager, rows, "test.csv"));
    expect(n).toBe(2);
    const [{ c }] = await as(a, F.admin, (tx) => tx`select count(*)::int as c from assets where code like 'IMP-%'`);
    expect(c).toBe(2);
  });
  it("si alguna fila es inválida no importa ninguna", async () => {
    const rows = [header, ["IMP-3", "Correcto", "TAP", ""], ["IMP-4", "Mala categoría", "NOEXISTE", ""]];
    const p = await as(a, F.manager, (tx) => previewImport(tx, rows));
    expect(p.issues).toHaveLength(1);
    await expect(as(a, F.manager, (tx) => commitImport(tx, F.manager, rows, "test.csv"))).rejects.toThrow(/error/);
    const [{ c }] = await as(a, F.admin, (tx) => tx`select count(*)::int as c from assets where code in ('IMP-3','IMP-4')`);
    expect(c).toBe(0);
  });
  it("detecta IDs ya existentes", async () => {
    const p = await as(a, F.manager, (tx) => previewImport(tx, [header, ["IMP-1", "Repetido", "TAP", ""]]));
    expect(p.issues[0].message).toMatch(/ya existe/);
  });
  it("el técnico no puede importar (RLS)", async () => {
    await expect(as(a, F.tech, (tx) => commitImport(tx, F.tech, [header, ["IMP-9", "x", "TAP", ""]], "t.csv"))).rejects.toThrow(/row-level security/);
  });
});

d("Multipunto con plantilla", () => {
  it("evalúa por punto y globalmente con la plantilla de la categoría", async () => {
    const rules = { kind: "multipoint", point: { kind: "numeric", unit: "Ω", max: { value: "1e9", inclusive: false } }, aggregation: { mode: "all_pass" } };
    const { criterionId } = await makeCriterion(a, F.manager, rules, "MULTI-1");
    const assetId = await as(a, F.manager, async (tx) => {
      const [c] = await tx`update categories set criterion_id = ${criterionId}, record_method = 'multipoint' where org_id = ${F.orgId} and code = 'MES' returning id`;
      const [t] = await tx`insert into point_templates(org_id, category_id, name) values (${F.orgId}, ${c.id}, 'Mesa 2 puntos') returning id`;
      await tx`insert into point_template_items(org_id, template_id, code, name, sort_order, required) values (${F.orgId}, ${t.id}, 'P1', 'Izquierda', 0, true), (${F.orgId}, ${t.id}, 'P2', 'Derecha', 1, true)`;
      return c.id as string;
    });
    const id = await as(a, F.admin, async (tx) => (await tx`insert into assets(org_id, code, scan_code, name, category_id) values (${F.orgId}, 'MES-T1', 'MES-T1', 'Mesa', ${assetId}) returning id`)[0].id as string);
    const base = { instrumentNotRequired: false, signatureConfirmed: false, fromOffline: false, createNc: false };
    const s = orgSettingsSchema.parse({ instrumentPolicy: "warn" });
    const r1 = await as(a, F.tech, (tx) => recordMeasurement(tx, F.tech, s, { ...base, clientId: randomUUID(), assetId: id, input: { kind: "multipoint", points: { P1: { value: "1e6" } } } }));
    expect(r1.result).toBe("incomplete");
    const r2 = await as(a, F.tech, (tx) => recordMeasurement(tx, F.tech, s, { ...base, clientId: randomUUID(), assetId: id, input: { kind: "multipoint", points: { P1: { value: "1e6" }, P2: { value: "2", unit: "GΩ" } } } }));
    // GΩ no está entre las unidades admitidas por este criterio: se rechaza (incompleto), no se convierte
    expect(r2.result).toBe("incomplete");
    const r3 = await as(a, F.tech, (tx) => recordMeasurement(tx, F.tech, s, { ...base, clientId: randomUUID(), assetId: id, input: { kind: "multipoint", points: { P1: { value: "1e6" }, P2: { value: "2e9" } } } }));
    expect(r3.result).toBe("fail");
    const vals = await as(a, F.admin, (tx) => tx`select point_code, result, normalized_value from measurement_values where measurement_id = ${r3.id} order by sort_order`);
    expect(vals.map((v) => [v.point_code, v.result])).toEqual([["P1", "pass"], ["P2", "fail"]]);
    expect(vals[1].normalized_value).toBe("2000000000");
  });
});

d("Campañas", () => {
  it("crea por categoría, registra progreso y exige confirmar el cierre con pendientes", async () => {
    const [cat] = await as(a, F.admin, (tx) => tx`select id from categories where org_id = ${F.orgId} and code = 'TAP'`);
    await as(a, F.admin, (tx) => tx`insert into assets(org_id, code, scan_code, name, category_id) values (${F.orgId}, 'TAP-C1', 'TAP-C1', 'Tapete', ${cat.id}), (${F.orgId}, 'TAP-C2', 'TAP-C2', 'Tapete', ${cat.id})`);
    const c = await as(a, F.manager, (tx) => createCampaign(tx, F.manager, { name: "Test", description: null, locationId: null, planId: null, startsOn: "2026-01-01", endsOn: "2026-12-31", ownerUserId: F.manager.userId, technicianIds: [F.tech.userId], categoryIds: [cat.id], mode: "category", assetIds: [], pointIds: [] }));
    expect(c.code).toMatch(/^CMP-\d{4}$/);
    const mgr = new Set(["edit", "campaign.close", "validate"]);
    await as(a, F.manager, (tx) => transitionCampaign(tx, F.manager, mgr, c.id, "in_progress", {}));
    const [asset] = await as(a, F.admin, (tx) => tx`select a.id from campaign_items ci join assets a on a.id = ci.asset_id where ci.campaign_id = ${c.id} limit 1`);
    await as(a, F.tech, (tx) => recordMeasurement(tx, F.tech, orgSettingsSchema.parse({ instrumentPolicy: "warn" }), { clientId: randomUUID(), assetId: asset.id, campaignId: c.id, instrumentNotRequired: false, input: { kind: "not_measurable", reason: "Zona inaccesible" }, signatureConfirmed: false, fromOffline: false, createNc: false }));
    const sum = await as(a, F.manager, (tx) => campaignSummary(tx, c.id));
    expect(sum.done).toBe(1);
    expect(sum.pending).toBeGreaterThan(0);
    await as(a, F.manager, (tx) => transitionCampaign(tx, F.manager, mgr, c.id, "completed", {}));
    await expect(as(a, F.manager, (tx) => transitionCampaign(tx, F.manager, mgr, c.id, "closed", {}))).rejects.toThrow(/Confirme expresamente/);
    await expect(as(a, F.tech, (tx) => transitionCampaign(tx, F.tech, new Set(["read"]), c.id, "closed", { acknowledge: true }))).rejects.toThrow(/permiso/);
    await as(a, F.manager, (tx) => transitionCampaign(tx, F.manager, mgr, c.id, "closed", { acknowledge: true, notes: "Pendientes reprogramados" }));
    const [row] = await as(a, F.admin, (tx) => tx`select status, close_notes from campaigns where id = ${c.id}`);
    expect(row.status).toBe("closed");
    expect(row.close_notes).toMatch(/pendientes \(no realizados\)/);
    // Una campaña cerrada no admite mediciones nuevas
    await expect(as(a, F.tech, (tx) => recordMeasurement(tx, F.tech, settings, { clientId: randomUUID(), assetId: asset.id, campaignId: c.id, instrumentNotRequired: false, input: { kind: "not_applicable", reason: "x y z" }, signatureConfirmed: false, fromOffline: false, createNc: false }))).rejects.toThrow(/no está en curso/);
  });
});

d("Informes y etiquetas", () => {
  it("genera todos los informes PDF", async () => {
    const s = fakeSession(F.manager, ["read", "reports"]);
    for (const t of ["summary", "measurements", "overdue", "instruments", "nonconformities"]) {
      const r = await as(a, F.manager, (tx) => buildReport(tx, s, t, {}));
      expect(r?.pdf.subarray(0, 5).toString(), t).toBe("%PDF-");
    }
    const [c] = await as(a, F.admin, (tx) => tx`select id from campaigns where org_id = ${F.orgId} limit 1`);
    const r = await as(a, F.manager, (tx) => buildReport(tx, s, "campaign", {}, c.id));
    expect(r?.pdf.length).toBeGreaterThan(1000);
  });
  it("genera etiquetas PDF en hoja y en rollo con QR que solo contiene el enlace", async () => {
    const ids = (await as(a, F.admin, (tx) => tx`select id from assets where org_id = ${F.orgId} limit 5`)).map((r) => r.id as string);
    const items = await as(a, F.tech, (tx) => labelData(tx, ids));
    expect(items).toHaveLength(ids.length);
    for (const i of items) expect(i.url).toMatch(/\/a\/[A-Za-z0-9%._-]+$/);
    const sheet = await labelsPdf(items, 50, 30, DEFAULT_LABEL_LAYOUT, null);
    expect(sheet.subarray(0, 5).toString()).toBe("%PDF-");
    const roll = await labelsPdf(items, 60, 40, labelLayoutSchema.parse({ code: "both", sheet: { paper: "roll", gapMm: 0, marginMm: 0 } }), null);
    expect(roll.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
