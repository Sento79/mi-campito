import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { app, as, makeCriterion, makeOrg, owner, type Fixture } from "./helpers";
import { dbTestsEnabled } from "./env";
import { recordMeasurement, invalidateMeasurement, findAssetByScan } from "../../src/lib/server/services/measurements";
import { createNonconformity, transitionNonconformity } from "../../src/lib/server/services/nonconformities";
import { orgSettingsSchema } from "../../src/lib/domain/settings";

const d = dbTestsEnabled() ? describe : describe.skip;

let o: postgres.Sql;
let a: postgres.Sql;
let A: Fixture;
let B: Fixture;
let catId: string;
let assetId: string;
let instrumentId: string;
let expiredInstrumentId: string;

const settings = orgSettingsSchema.parse({ instrumentPolicy: "review", autoCreateNc: "ask" });
const RULES = { kind: "numeric", unit: "Ω", min: { value: "1e6", inclusive: true }, max: { value: "1e9", inclusive: false }, allowedUnits: ["MΩ", "GΩ"] };

beforeAll(async () => {
  if (!dbTestsEnabled()) return;
  o = owner();
  a = app();
  A = await makeOrg(o, "alfa");
  B = await makeOrg(o, "beta");
  const { criterionId } = await makeCriterion(a, A.manager, RULES);
  await as(a, A.manager, async (tx) => {
    const [c] = await tx`update categories set criterion_id = ${criterionId}, period_unit = 'month', period_count = 3 where org_id = ${A.orgId} and code = 'TAP' returning id`;
    catId = c.id;
  });
  await as(a, A.admin, async (tx) => {
    const [as1] = await tx`insert into assets(org_id, code, scan_code, name, category_id) values (${A.orgId}, 'TAP-0001', 'QR-TAP-0001', 'Tapete 1', ${catId}) returning id`;
    assetId = as1.id;
    const [i1] = await tx`insert into instruments(org_id, code, type, status, last_calibrated_on, calibration_due_on) values (${A.orgId}, 'MEG-01', 'Medidor de resistencia', 'active', current_date - 30, current_date + 300) returning id`;
    const [i2] = await tx`insert into instruments(org_id, code, type, status, last_calibrated_on, calibration_due_on) values (${A.orgId}, 'MEG-02', 'Medidor de resistencia', 'active', current_date - 400, current_date - 35) returning id`;
    instrumentId = i1.id;
    expiredInstrumentId = i2.id;
  });
});

afterAll(async () => {
  await a?.end();
  await o?.end();
});

d("RLS y aislamiento entre organizaciones", () => {
  it("sin contexto no se ve ningún dato", async () => {
    const rows = await a`select count(*)::int as n from assets`;
    expect(rows[0].n).toBe(0);
  });

  it("un usuario de otra organización no ve los activos", async () => {
    const rows = await as(a, B.admin, (tx) => tx`select id from assets where id = ${assetId}`);
    expect(rows).toHaveLength(0);
  });

  it("falsear app.org_id sin pertenencia no da acceso", async () => {
    const rows = await as(a, { orgId: A.orgId, userId: B.admin.userId }, (tx) => tx`select id from assets`);
    expect(rows).toHaveLength(0);
  });

  it("no se puede insertar en otra organización", async () => {
    await expect(
      as(a, B.admin, (tx) => tx`insert into assets(org_id, code, scan_code, name, category_id) values (${A.orgId}, 'X', 'X', 'X', ${catId})`),
    ).rejects.toThrow(/row-level security/);
  });

  it("el técnico no puede crear activos ni criterios", async () => {
    await expect(
      as(a, A.tech, (tx) => tx`insert into assets(org_id, code, scan_code, name, category_id) values (${A.orgId}, 'TEC-1', 'TEC-1', 'X', ${catId})`),
    ).rejects.toThrow(/row-level security/);
    await expect(as(a, A.tech, (tx) => tx`insert into criteria(org_id, code, name) values (${A.orgId}, 'C-T', 'x')`)).rejects.toThrow(/row-level security/);
  });

  it("el rol consulta no puede registrar mediciones", async () => {
    await expect(
      as(a, A.viewer, (tx) => recordMeasurement(tx, A.viewer, settings, { clientId: randomUUID(), assetId, instrumentNotRequired: false, input: { kind: "numeric", value: "5e6" }, signatureConfirmed: false, fromOffline: false, createNc: false })),
    ).rejects.toThrow(/row-level security/);
  });

  it("la app no puede leer sesiones ni hashes de contraseña", async () => {
    await expect(a`select * from sessions`).rejects.toThrow(/permission denied/);
    await expect(as(a, A.admin, (tx) => tx`update users set password_hash = 'x' where id = ${A.admin.userId}`)).rejects.toThrow(/permission denied/);
  });

  it("la auditoría solo la leen roles con permiso y nadie la modifica", async () => {
    const viewer = await as(a, A.viewer, (tx) => tx`select count(*)::int as n from audit_log`);
    expect(viewer[0].n).toBe(0);
    const adm = await as(a, A.admin, (tx) => tx`select count(*)::int as n from audit_log`);
    expect(adm[0].n).toBeGreaterThan(0);
    await expect(as(a, A.admin, (tx) => tx`delete from audit_log`)).rejects.toThrow(/permission denied/);
    await expect(o`update audit_log set summary = 'x'`).rejects.toThrow(/solo inserción/);
  });
});

d("Mediciones: resultado, trazabilidad e inmutabilidad", () => {
  let mId: string;

  it("registra una medición conforme con versión de criterio y valores originales", async () => {
    const r = await as(a, A.tech, (tx) =>
      recordMeasurement(tx, A.tech, settings, { clientId: randomUUID(), assetId, instrumentId, instrumentNotRequired: false, input: { kind: "numeric", value: "2,5", unit: "MΩ" }, signatureConfirmed: false, fromOffline: false, createNc: false }),
    );
    expect(r.result).toBe("pass");
    mId = r.id;
    const [m] = await as(a, A.admin, (tx) => tx`select m.*, mv.raw_input, mv.raw_unit, mv.normalized_value from measurements m join measurement_values mv on mv.measurement_id = m.id where m.id = ${mId}`);
    expect(m.raw_input).toBe("2,5");
    expect(m.raw_unit).toBe("MΩ");
    expect(m.normalized_value).toBe("2500000");
    expect(m.criterion_version_id).toBeTruthy();
    expect(m.rules_snapshot.kind).toBe("numeric");
    expect(m.instrument_snapshot.calibration_valid).toBe(true);
    const [asset] = await as(a, A.admin, (tx) => tx`select last_result, next_due_at, last_measured_at from assets where id = ${assetId}`);
    expect(asset.last_result).toBe("pass");
    // Próximo vencimiento = medición + 3 meses
    const diffDays = (new Date(asset.next_due_at).getTime() - new Date(asset.last_measured_at).getTime()) / 86400000;
    expect(diffDays).toBeGreaterThan(88);
    expect(diffDays).toBeLessThan(93);
  });

  it("es idempotente por client_id (cola offline)", async () => {
    const clientId = randomUUID();
    const input = { clientId, assetId, instrumentId, instrumentNotRequired: false, input: { kind: "numeric" as const, value: "3e6" }, signatureConfirmed: false, fromOffline: true, createNc: false };
    const r1 = await as(a, A.tech, (tx) => recordMeasurement(tx, A.tech, settings, input));
    const r2 = await as(a, A.tech, (tx) => recordMeasurement(tx, A.tech, settings, input));
    expect(r2.duplicate).toBe(true);
    expect(r2.id).toBe(r1.id);
  });

  it("no se puede modificar ni borrar una medición registrada", async () => {
    await expect(as(a, A.admin, (tx) => tx`update measurements set result = 'fail' where id = ${mId}`)).rejects.toThrow(/inmutable/);
    // Con RLS la app ni siquiera ve filas actualizables; y el disparador lo impide incluso al propietario
    const upd = await as(a, A.admin, (tx) => tx`update measurement_values set raw_input = '9' where measurement_id = ${mId} returning id`);
    expect(upd).toHaveLength(0);
    await expect(o`update measurement_values set raw_input = '9' where measurement_id = ${mId}`).rejects.toThrow(/inmutables/);
    await expect(o`update measurements set result = 'fail' where id = ${mId}`).rejects.toThrow(/inmutable/);
    await expect(o`delete from measurements where id = ${mId}`).rejects.toThrow(/no se pueden borrar/);
  });

  it("el técnico no puede invalidar; el responsable sí, con motivo, y se conserva el registro", async () => {
    await expect(as(a, A.tech, (tx) => invalidateMeasurement(tx, A.tech, mId, "error de lectura"))).rejects.toThrow(/permiso/);
    const before = await as(a, A.manager, (tx) => tx`select count(*)::int as n from measurements where id = ${mId}`);
    await as(a, A.manager, (tx) => invalidateMeasurement(tx, A.manager, mId, "Electrodo mal apoyado"));
    const [m] = await as(a, A.admin, (tx) => tx`select status, invalidation_reason, result from measurements where id = ${mId}`);
    expect(before[0].n).toBe(1);
    expect(m.status).toBe("invalidated");
    expect(m.result).toBe("pass");
    expect(m.invalidation_reason).toBe("Electrodo mal apoyado");
    await expect(as(a, A.admin, (tx) => tx`update measurements set invalidation_reason = 'otro' where id = ${mId}`)).rejects.toThrow(/inmutable/);
  });

  it("al invalidar no se puede alterar el valor ni el resultado", async () => {
    const r = await as(a, A.tech, (tx) => recordMeasurement(tx, A.tech, settings, { clientId: randomUUID(), assetId, instrumentId, instrumentNotRequired: false, input: { kind: "numeric", value: "5e6" }, signatureConfirmed: false, fromOffline: false, createNc: false }));
    await expect(
      as(a, A.manager, (tx) => tx`update measurements set status = 'invalidated', invalidated_at = now(), invalidated_by = ${A.manager.userId}, invalidation_reason = 'x', result = 'fail' where id = ${r.id}`),
    ).rejects.toThrow(/solo se pueden registrar los datos de invalidación/);
  });

  it("no conforme crea NC si se solicita, vinculada a la medición", async () => {
    const r = await as(a, A.tech, (tx) => recordMeasurement(tx, A.tech, settings, { clientId: randomUUID(), assetId, instrumentId, instrumentNotRequired: false, input: { kind: "numeric", value: "5", unit: "GΩ" }, signatureConfirmed: false, fromOffline: false, createNc: true }));
    expect(r.result).toBe("fail");
    expect(r.ncCode).toMatch(/^NC-\d{4}-\d{4}$/);
    const links = await as(a, A.admin, (tx) => tx`select * from nc_links where measurement_id = ${r.id}`);
    expect(links).toHaveLength(1);
    const [asset] = await as(a, A.admin, (tx) => tx`select last_result, next_due_at, last_measured_at from assets where id = ${assetId}`);
    expect(asset.last_result).toBe("fail");
    expect(new Date(asset.next_due_at).getTime()).toBe(new Date(asset.last_measured_at).getTime());
  });

  it("instrumento fuera de calibración → requiere revisión (política review)", async () => {
    const r = await as(a, A.tech, (tx) => recordMeasurement(tx, A.tech, settings, { clientId: randomUUID(), assetId, instrumentId: expiredInstrumentId, instrumentNotRequired: false, input: { kind: "numeric", value: "5e6" }, signatureConfirmed: false, fromOffline: false, createNc: false }));
    expect(r.result).toBe("review");
  });

  it("instrumento fuera de calibración con política block → no se guarda", async () => {
    const block = orgSettingsSchema.parse({ instrumentPolicy: "block" });
    await expect(
      as(a, A.tech, (tx) => recordMeasurement(tx, A.tech, block, { clientId: randomUUID(), assetId, instrumentId: expiredInstrumentId, instrumentNotRequired: false, input: { kind: "numeric", value: "5e6" }, signatureConfirmed: false, fromOffline: false, createNc: false })),
    ).rejects.toThrow(/impide registrar/);
  });

  it("sin criterio vigente nunca es conforme", async () => {
    const id = await as(a, A.admin, async (tx) => {
      const [c] = await tx`select id from categories where org_id = ${A.orgId} and code = 'SIL'`;
      const [x] = await tx`insert into assets(org_id, code, scan_code, name, category_id) values (${A.orgId}, 'SIL-1', 'SIL-1', 'Silla', ${c.id}) returning id`;
      return x.id as string;
    });
    const r = await as(a, A.tech, (tx) => recordMeasurement(tx, A.tech, settings, { clientId: randomUUID(), assetId: id, instrumentId, instrumentNotRequired: false, input: { kind: "numeric", value: "5e6" }, signatureConfirmed: false, fromOffline: false, createNc: false }));
    expect(r.result).toBe("review");
  });

  it("si el criterio cambió entre pantalla y guardado → revisión", async () => {
    const r = await as(a, A.tech, (tx) => recordMeasurement(tx, A.tech, settings, { clientId: randomUUID(), assetId, instrumentId, instrumentNotRequired: false, input: { kind: "numeric", value: "5e6" }, signatureConfirmed: false, fromOffline: true, createNc: false, expectedCriterionVersionId: randomUUID() }));
    expect(r.result).toBe("review");
  });

  it("las versiones de criterio publicadas son inmutables", async () => {
    await expect(as(a, A.manager, (tx) => tx`update criterion_versions set rules = '{}' where org_id = ${A.orgId}`)).rejects.toThrow(/inmutable/);
  });

  it("búsqueda por escaneo: código de escaneo o ID legible sin distinguir mayúsculas", async () => {
    const r1 = await as(a, A.tech, (tx) => findAssetByScan(tx, "QR-TAP-0001"));
    const r2 = await as(a, A.tech, (tx) => findAssetByScan(tx, "tap-0001"));
    const r3 = await as(a, B.tech, (tx) => findAssetByScan(tx, "TAP-0001"));
    expect(r1?.id).toBe(assetId);
    expect(r2?.id).toBe(assetId);
    expect(r3).toBeNull();
  });
});

d("No conformidades y campañas", () => {
  it("no se cierra una NC sin verificación ni permiso de validación", async () => {
    const nc = await as(a, A.tech, (tx) => createNonconformity(tx, A.tech, { title: "Tapete despegado", severityKey: "minor", links: [{ assetId }] }));
    const techPerms = new Set(["read", "measure"]);
    const mgrPerms = new Set(["read", "edit", "validate"]);
    await as(a, A.manager, (tx) => tx`update nonconformities set corrective_action = 'Sustituir tapete' where id = ${nc.id}`);
    await as(a, A.manager, (tx) => transitionNonconformity(tx, A.manager, mgrPerms, nc.id, "verification", {}));
    await expect(as(a, A.tech, (tx) => transitionNonconformity(tx, A.tech, techPerms, nc.id, "closed", { verificationNotes: "ok" }))).rejects.toThrow(/validación/);
    await expect(as(a, A.manager, (tx) => transitionNonconformity(tx, A.manager, mgrPerms, nc.id, "closed", {}))).rejects.toThrow(/verificación/);
    // Ni siquiera saltándose el servicio
    await expect(as(a, A.manager, (tx) => tx`update nonconformities set status = 'closed' where id = ${nc.id}`)).rejects.toThrow(/nonconformities_check|check constraint/);
    await as(a, A.manager, (tx) => transitionNonconformity(tx, A.manager, mgrPerms, nc.id, "closed", { verificationNotes: "Remedición conforme 3,1 MΩ" }));
    const [row] = await as(a, A.admin, (tx) => tx`select status, verified_by from nonconformities where id = ${nc.id}`);
    expect(row.status).toBe("closed");
    expect(row.verified_by).toBe(A.manager.userId);
    await expect(as(a, A.manager, (tx) => tx`update nonconformities set title = 'cambio' where id = ${nc.id}`)).rejects.toThrow(/reábrala/);
  });

  it("solo con permiso de cierre se cierra una campaña; cerrada no admite cambios", async () => {
    const cid = await as(a, A.manager, async (tx) => {
      const [c] = await tx`insert into campaigns(org_id, code, name, starts_on, ends_on, status) values (${A.orgId}, ${"CMP-" + randomUUID().slice(0, 4)}, 'Trimestral', current_date, current_date + 30, 'in_progress') returning id`;
      await tx`update campaigns set status = 'completed' where id = ${c.id}`;
      return c.id as string;
    });
    // Un admin de otra organización no la ve
    const other = await as(a, B.admin, (tx) => tx`update campaigns set status = 'closed', closed_by = ${B.admin.userId}, closed_at = now() where id = ${cid} returning id`);
    expect(other).toHaveLength(0);
    await as(a, A.manager, (tx) => tx`update campaigns set status = 'closed', closed_by = ${A.manager.userId}, closed_at = now() where id = ${cid}`);
    await expect(as(a, A.manager, (tx) => tx`update campaigns set name = 'x' where id = ${cid}`)).rejects.toThrow(/no admite cambios/);
  });

  it("el plano queda protegido mientras hay una campaña en curso", async () => {
    const { planId, pointId } = await as(a, A.manager, async (tx) => {
      const [doc] = await tx`insert into documents(org_id, entity_type, kind, file_name, mime_type, size_bytes, sha256, storage_key) values (${A.orgId}, 'floor_plan', 'plan_original', 'p.png', 'image/png', 10, 'x', ${randomUUID()}) returning id`;
      const [p] = await tx`insert into floor_plans(org_id, title) values (${A.orgId}, 'Nave 1') returning id`;
      await tx`insert into floor_plan_versions(org_id, plan_id, version, original_document_id, page_count) values (${A.orgId}, ${p.id}, 1, ${doc.id}, 1)`;
      const [pt] = await tx`insert into plan_points(org_id, plan_id, code, name, x, y) values (${A.orgId}, ${p.id}, 'S-01', 'Suelo 1', 0.25, 0.5) returning id`;
      await tx`insert into campaigns(org_id, code, name, starts_on, ends_on, status, plan_id) values (${A.orgId}, ${"CMP-" + randomUUID().slice(0, 4)}, 'Suelos', current_date, current_date + 7, 'in_progress', ${p.id})`;
      return { planId: p.id as string, pointId: pt.id as string };
    });
    await expect(as(a, A.manager, (tx) => tx`update plan_points set x = 0.3 where id = ${pointId}`)).rejects.toThrow(/campaña en curso/);
    await as(a, A.manager, async (tx) => {
      await tx`select set_config('app.layout_override', 'on', true)`;
      await tx`update plan_points set x = 0.3 where id = ${pointId}`;
    });
    const [pt] = await as(a, A.admin, (tx) => tx`select x::text, y::text, plan_id from plan_points where id = ${pointId}`);
    expect(pt.x).toBe("0.30000000");
    expect(pt.y).toBe("0.50000000");
    expect(pt.plan_id).toBe(planId);
  });
});

d("Endurecimiento tras revisión (0006)", () => {
  it("no se puede referenciar un activo de otra organización en una medición", async () => {
    const [bCat] = await as(a, B.admin, (tx) => tx`select id from categories where org_id = ${B.orgId} and code = 'TAP'`);
    const bAsset = await as(a, B.admin, async (tx) => (await tx`insert into assets(org_id, code, scan_code, name, category_id) values (${B.orgId}, 'B-1', 'B-1', 'Ajeno', ${bCat.id}) returning id`)[0].id as string);
    await expect(
      as(a, A.tech, (tx) => tx`insert into measurements(org_id, client_id, asset_id, method, result, measured_by) values (${A.orgId}, ${randomUUID()}, ${bAsset}, 'numeric', 'pass', ${A.tech.userId})`),
    ).rejects.toThrow(/no pertenece a la organización/);
    await expect(as(a, A.admin, (tx) => tx`insert into nc_links(org_id, nc_id, asset_id) select ${A.orgId}, id, ${bAsset} from nonconformities where org_id = ${A.orgId} limit 1`)).rejects.toThrow(/no pertenece/);
  });

  it("no se puede crear una versión de criterio sobre un criterio de otra organización", async () => {
    const bCrit = await as(a, B.manager, async (tx) => (await tx`insert into criteria(org_id, code, name) values (${B.orgId}, 'B-CRIT', 'x') returning id`)[0].id as string);
    await expect(
      as(a, A.manager, (tx) => tx`insert into criterion_versions(org_id, criterion_id, version, status, rules, change_reason) values (${A.orgId}, ${bCrit}, 1, 'draft', '{}', 'ataque')`),
    ).rejects.toThrow(/no pertenece/);
  });

  it("cambiar contraseña exige un actor autenticado", async () => {
    await expect(a`select app_auth_set_password(${A.tech.userId}, 'x')`).rejects.toThrow(/sin usuario autenticado/);
    await expect(a`select app_session_revoke_user(${A.tech.userId})`).rejects.toThrow(/sin usuario autenticado/);
  });

  it("la app no puede leer password_hash ni ejecutar funciones internas", async () => {
    await expect(as(a, A.admin, (tx) => tx`select password_hash from users`)).rejects.toThrow(/permission denied/);
    const ok = await as(a, A.admin, (tx) => tx`select id, email from users where id = ${A.admin.userId}`);
    expect(ok).toHaveLength(1);
    await expect(as(a, A.admin, (tx) => tx`select app_refresh_asset_summary(${assetId})`)).rejects.toThrow(/permission denied/);
  });

  it("no se crean campañas ni NC ya cerradas", async () => {
    await expect(as(a, A.admin, (tx) => tx`insert into campaigns(org_id, code, name, starts_on, ends_on, status, closed_by, closed_at) values (${A.orgId}, 'CMP-X', 'x', current_date, current_date, 'closed', ${A.admin.userId}, now())`)).rejects.toThrow(/debe crearse/);
    await expect(as(a, A.admin, (tx) => tx`insert into nonconformities(org_id, code, title, status, verified_by, verified_at, verification_notes, closed_by, closed_at) values (${A.orgId}, 'NC-X', 'x', 'closed', ${A.admin.userId}, now(), 'ok ok', ${A.admin.userId}, now())`)).rejects.toThrow(/debe crearse/);
  });

  it("una versión publicada no vuelve a borrador", async () => {
    await expect(as(a, A.manager, (tx) => tx`update criterion_versions set status = 'draft' where org_id = ${A.orgId} and status = 'active'`)).rejects.toThrow(/no puede volver a borrador/);
  });

  it("no se pueden añadir valores a una medición ya registrada", async () => {
    const [m] = await as(a, A.admin, (tx) => tx`select id from measurements where org_id = ${A.orgId} and status = 'final' limit 1`);
    await expect(as(a, A.tech, (tx) => tx`insert into measurement_values(org_id, measurement_id, value_kind, result) values (${A.orgId}, ${m.id}, 'numeric', 'pass')`)).rejects.toThrow(/ya registrada/);
  });

  it("las ubicaciones no admiten ciclos", async () => {
    const [x, y] = await as(a, A.admin, async (tx) => {
      const [p] = await tx`insert into locations(org_id, kind, code, name) values (${A.orgId}, 'zone', 'CYC-X', 'X') returning id`;
      const [q] = await tx`insert into locations(org_id, parent_id, kind, code, name) values (${A.orgId}, ${p.id}, 'zone', 'CYC-Y', 'Y') returning id`;
      return [p.id as string, q.id as string];
    });
    await expect(as(a, A.admin, (tx) => tx`update locations set parent_id = ${y} where id = ${x}`)).rejects.toThrow(/descendientes/);
    const sub = await as(a, A.admin, (tx) => tx`select app_location_subtree(${x}) as id`);
    expect(sub).toHaveLength(2);
  });

  it("cambiar la periodicidad de la categoría recalcula el vencimiento heredado", async () => {
    const before = await as(a, A.admin, (tx) => tx`select next_due_at, last_measured_at from assets where id = ${assetId}`);
    await as(a, A.manager, (tx) => tx`update categories set period_unit = 'year', period_count = 1 where org_id = ${A.orgId} and code = 'TAP'`);
    const [after] = await as(a, A.admin, (tx) => tx`select next_due_at, last_measured_at, last_result from assets where id = ${assetId}`);
    if (after.last_result === "pass") expect(new Date(after.next_due_at).getTime()).toBeGreaterThan(new Date(before[0].next_due_at).getTime());
    else expect(new Date(after.next_due_at).getTime()).toBe(new Date(after.last_measured_at).getTime());
  });
});
