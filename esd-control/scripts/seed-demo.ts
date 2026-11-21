/**
 * Datos de DEMOSTRACIÓN. Crea una organización SEPARADA marcada como demo
 * (is_demo = true), por lo que nunca se mezcla con datos reales: la interfaz
 * muestra un aviso permanente al trabajar en ella.
 *
 * Los criterios creados aquí son ILUSTRATIVOS, no normativos.
 * Requiere DEMO_SEED_ENABLED=true y DEMO_PASSWORD.
 */
import { requireEnv } from "./env";
import postgres from "postgres";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createOrganization, createUserWithRole } from "../src/lib/server/bootstrap";
import { evaluate, type CriterionRules } from "../src/lib/domain/criteria";
import { demoFloorPlan } from "./lib/png";

const DEMO_SLUG = "demo";

async function main() {
  if (process.env.DEMO_SEED_ENABLED !== "true") {
    console.error("Seed de demo desactivado. Defina DEMO_SEED_ENABLED=true para ejecutarlo (nunca en producción).");
    process.exit(1);
  }
  const password = requireEnv("DEMO_PASSWORD");
  const sql = postgres(requireEnv("MIGRATION_DATABASE_URL"), { max: 2, onnotice: () => {}, types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } } });
  try {
    const [exists] = await sql`select id from organizations where slug = ${DEMO_SLUG}`;
    if (exists) {
      console.log("La organización demo ya existe; no se modifica. (Para regenerarla, recree la base de datos de desarrollo.)");
      return;
    }
    const orgId = await createOrganization(sql, { name: "Demo Electrónica S.A. (DEMO)", slug: DEMO_SLUG, isDemo: true });
    const users: Record<string, string> = {};
    for (const [role, email, name] of [
      ["admin", "admin@demo.local", "Ana Administradora"],
      ["esd_manager", "responsable@demo.local", "Rubén Responsable ESD"],
      ["technician", "tecnico@demo.local", "Teresa Técnica"],
      ["technician", "tecnico2@demo.local", "Tomás Técnico"],
      ["auditor", "auditor@demo.local", "Aurora Auditora"],
      ["viewer", "consulta@demo.local", "Carlos Consulta"],
    ]) {
      users[email] = await createUserWithRole(sql, orgId, { email, fullName: name, password, roleKey: role });
    }
    const mgr = users["responsable@demo.local"];
    const techs = [users["tecnico@demo.local"], users["tecnico2@demo.local"]];

    await sql.begin(async (tx) => {
      // --- Ubicaciones
      const [root] = await tx`select id from locations where org_id = ${orgId} and kind = 'company'`;
      const loc = async (parent: string, kind: string, code: string, name: string) =>
        (await tx`insert into locations(org_id, parent_id, kind, code, name) values (${orgId}, ${parent}, ${kind}, ${code}, ${name}) returning id`)[0].id as string;
      const plant = await loc(root.id, "plant", "PLT-VLC", "Planta Valencia");
      const nave = await loc(plant, "building", "NAV-1", "Nave 1 – Montaje");
      const epaA = await loc(nave, "zone", "EPA-A", "Zona EPA A");
      const epaB = await loc(nave, "zone", "EPA-B", "Zona EPA B");
      const alm = await loc(nave, "area", "ALM", "Almacén de componentes");
      const lines: string[] = [];
      for (let i = 1; i <= 4; i++) lines.push(await loc(epaA, "line", `L-A${i}`, `Línea A${i}`));
      for (let i = 1; i <= 4; i++) lines.push(await loc(epaB, "line", `L-B${i}`, `Línea B${i}`));

      // --- Procedimientos (ficticios)
      const proc = async (code: string, title: string) =>
        (await tx`insert into procedures(org_id, code, title, revision, norm_reference, description, created_by) values (${orgId}, ${code}, ${title}, 'A', 'DEMO – sustituir por la referencia del procedimiento real', 'Procedimiento ficticio para demostración.', ${mgr}) returning id`)[0].id as string;
      const pRtg = await proc("PR-DEMO-01", "Medición de resistencia a tierra (DEMO)");
      const pWs = await proc("PR-DEMO-02", "Comprobación de pulseras (DEMO)");
      const pVis = await proc("PR-DEMO-03", "Inspección visual de equipos (DEMO)");

      // --- Criterios ILUSTRATIVOS
      const crit = async (code: string, name: string, rules: CriterionRules, procedureId: string, unit: string | null) => {
        const [c] = await tx`insert into criteria(org_id, code, name, description) values (${orgId}, ${code}, ${name}, 'DEMO: límites ilustrativos, NO normativos.') returning id`;
        await tx`insert into criterion_versions(org_id, criterion_id, version, status, rules, unit, procedure_id, procedure_revision, norm_reference, change_reason, valid_from, approved_by, approved_at, created_by)
                 values (${orgId}, ${c.id}, 1, 'active', ${tx.json(rules as never)}, ${unit}, ${procedureId}, 'A', 'DEMO', 'Alta inicial de demostración', now() - interval '120 days', ${mgr}, now() - interval '120 days', ${mgr})`;
        return c.id as string;
      };
      const rtg: CriterionRules = { kind: "numeric", unit: "Ω", min: { value: "1e4", inclusive: true }, max: { value: "1e9", inclusive: false }, allowedUnits: ["kΩ", "MΩ", "GΩ"] };
      const cRtg = await crit("RTG-DEMO", "Resistencia a tierra superficies (DEMO)", rtg, pRtg, "Ω");
      const cWs = await crit("PUL-DEMO", "Sistema pulsera-cable (DEMO)", { kind: "numeric", unit: "Ω", min: { value: "7.5e5", inclusive: true }, max: { value: "3.5e7", inclusive: true }, allowedUnits: ["kΩ", "MΩ"] }, pWs, "Ω");
      const cMes = await crit("MES-DEMO", "Mesa ESD multipunto (DEMO)", { kind: "multipoint", point: rtg as never, aggregation: { mode: "all_pass" } }, pRtg, "Ω");
      const cCar = await crit("CAR-DEMO", "Carro ESD – estado (DEMO)", { kind: "select", options: [{ value: "ok", label: "Ruedas conductoras OK", outcome: "pass" }, { value: "worn", label: "Desgaste visible", outcome: "review" }, { value: "broken", label: "Rueda/cadena dañada", outcome: "fail" }] }, pVis, null);
      const cOtr = await crit("OTR-DEMO", "Inspección visual genérica (DEMO)", { kind: "checklist", items: [{ code: "c1", label: "Conexión a tierra presente", required: true, allowNA: false }, { code: "c2", label: "Sin daños visibles", required: true, allowNA: false }, { code: "c3", label: "Señalización EPA legible", required: false, allowNA: true }] }, pVis, null);

      const setCat = (code: string, criterionId: string, unit: string, count: number, procedureId: string, method: string, instrumentTypes: string[], instructions: string) =>
        tx`update categories set criterion_id = ${criterionId}, period_unit = ${unit}, period_count = ${count}, procedure_id = ${procedureId}, record_method = ${method},
             instrument_types = ${instrumentTypes}, instrument_required = ${instrumentTypes.length > 0}, instructions = ${instructions},
             precautions = 'DEMO: retire tensión de los equipos cercanos y utilice el electrodo indicado por el procedimiento.'
           where org_id = ${orgId} and code = ${code} returning id`;
      const RES = "Medidor de resistencia";
      const [tap] = await setCat("TAP", cRtg, "month", 3, pRtg, "numeric", [RES], "Coloque el electrodo en el centro del tapete y mida a tierra.");
      const [sil] = await setCat("SIL", cRtg, "month", 6, pRtg, "numeric", [RES], "Mida desde el asiento a tierra con la silla sobre suelo ESD.");
      const [mes] = await setCat("MES", cMes, "month", 3, pRtg, "multipoint", [RES], "Mida los tres puntos definidos en la plantilla.");
      const [pul] = await setCat("PUL", cWs, "week", 1, pWs, "numeric", ["Comprobador de pulseras"], "Conecte la pulsera al comprobador y lea el valor.");
      const [car] = await setCat("CAR", cCar, "semester", 1, pVis, "select", [], "Revise ruedas conductoras y cadena de arrastre.");
      const [sue] = await setCat("SUE", cRtg, "year", 1, pRtg, "numeric", [RES], "Mida en cada punto marcado en el plano con electrodo de 2,27 kg.");
      await setCat("OTR", cOtr, "month", 6, pVis, "checklist", [], "Complete la lista de comprobación.");
      const [tpl] = await tx`insert into point_templates(org_id, category_id, name, description) values (${orgId}, ${mes.id}, 'Mesa estándar 3 puntos (DEMO)', 'Izquierda, centro y derecha') returning id`;
      for (const [i, [code, name]] of [["P1", "Extremo izquierdo"], ["P2", "Centro"], ["P3", "Extremo derecho"]].entries()) {
        await tx`insert into point_template_items(org_id, template_id, code, name, sort_order, unit, required) values (${orgId}, ${tpl.id}, ${code}, ${name}, ${i}, 'Ω', true)`;
      }

      // --- Instrumentos
      const inst = async (code: string, type: string, model: string, last: string | null, due: string | null) =>
        (await tx`insert into instruments(org_id, code, type, manufacturer, model, serial_number, acquired_on, status, owner_user_id, location_id, last_calibrated_on, calibration_due_on)
                  values (${orgId}, ${code}, ${type}, 'DemoMetrics', ${model}, ${"SN-" + code}, current_date - 900, 'active', ${mgr}, ${plant}, ${last}::date, ${due}::date) returning id`)[0].id as string;
      const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
      const i1 = await inst("MEG-01", RES, "RM-100", day(-200), day(165));
      const i2 = await inst("MEG-02", RES, "RM-100", day(-355), day(10));
      const i3 = await inst("PUL-T1", "Comprobador de pulseras", "WT-20", day(-60), day(305));
      await inst("MEG-03", RES, "RM-80", day(-420), day(-55));
      for (const [id, last, due] of [[i1, day(-200), day(165)], [i2, day(-355), day(10)], [i3, day(-60), day(305)]]) {
        await tx`insert into calibrations(org_id, instrument_id, calibrated_on, due_on, provider, certificate_number, outcome, created_by) values (${orgId}, ${id}, ${last}, ${due}, 'Laboratorio DEMO', ${"CERT-" + id.slice(0, 6)}, 'pass', ${mgr})`;
      }

      // --- Activos
      const assets: { id: string; cat: string; rules: CriterionRules; inst: string | null; loc: string }[] = [];
      const addAsset = async (code: string, name: string, catId: string, locId: string, catKey: string, rules: CriterionRules, instId: string | null) => {
        const [a] = await tx`insert into assets(org_id, code, scan_code, name, category_id, location_id, manufacturer, model, serial_number, commissioned_on, owner_user_id, created_by)
          values (${orgId}, ${code}, ${code}, ${name}, ${catId}, ${locId}, 'DemoESD', ${catKey + "-STD"}, ${"S" + code.replace(/\D/g, "")}, current_date - 500, ${mgr}, ${mgr}) returning id`;
        assets.push({ id: a.id, cat: catKey, rules, inst: instId, loc: locId });
      };
      let n = 1;
      for (const l of lines) {
        for (let k = 0; k < 2; k++) await addAsset(`TAP-${String(n++).padStart(4, "0")}`, `Tapete de mesa ${k + 1}`, tap.id, l, "TAP", rtg, i1);
      }
      n = 1;
      for (const l of lines) await addAsset(`SIL-${String(n++).padStart(4, "0")}`, "Silla ESD operario", sil.id, l, "SIL", rtg, i1);
      n = 1;
      for (const l of lines.slice(0, 6)) await addAsset(`MES-${String(n++).padStart(4, "0")}`, "Mesa de trabajo ESD", mes.id, l, "MES", { kind: "multipoint", point: rtg as never, aggregation: { mode: "all_pass" } }, i1);
      n = 1;
      for (const l of lines) await addAsset(`PUL-${String(n++).padStart(4, "0")}`, "Pulsera puesto de trabajo", pul.id, l, "PUL", { kind: "numeric", unit: "Ω", min: { value: "7.5e5", inclusive: true }, max: { value: "3.5e7", inclusive: true }, allowedUnits: ["kΩ", "MΩ"] }, i3);
      for (let k = 1; k <= 3; k++) await addAsset(`CAR-${String(k).padStart(4, "0")}`, "Carro de transporte ESD", car.id, alm, "CAR", { kind: "select", options: [] } as never, null);

      // --- Historial de mediciones (90 días). Inserción directa con evaluación del motor real.
      let measured = 0;
      const rnd = mulberry32(42);
      for (const a of assets) {
        const times = a.cat === "PUL" ? 8 : a.cat === "CAR" ? 1 : 2;
        for (let t = 0; t < times; t++) {
          // Algunos activos quedan sin medir o vencidos deliberadamente
          if (rnd() < 0.12) continue;
          const daysAgo = Math.floor(((times - t) / times) * 85 * rnd()) + (a.cat === "PUL" ? t * 9 : 0) + 1;
          const failing = rnd() < 0.08;
          let input: Parameters<typeof evaluate>[1];
          let rules: CriterionRules = a.rules;
          if (a.cat === "CAR") {
            rules = { kind: "select", options: [{ value: "ok", label: "Ruedas conductoras OK", outcome: "pass" }, { value: "worn", label: "Desgaste visible", outcome: "review" }, { value: "broken", label: "Rueda/cadena dañada", outcome: "fail" }] };
            input = { kind: "select", option: failing ? "broken" : rnd() < 0.2 ? "worn" : "ok" };
          } else if (a.cat === "MES") {
            const v = () => (failing && rnd() < 0.5 ? "2.4e9" : `${(1 + rnd() * 9).toFixed(1)}e${5 + Math.floor(rnd() * 3)}`);
            input = { kind: "multipoint", points: { P1: { value: v() }, P2: { value: v() }, P3: { value: v() } } };
          } else if (a.cat === "PUL") {
            input = { kind: "numeric", value: failing ? "8.2e7" : `${(1 + rnd() * 9).toFixed(2)}`, unit: "MΩ" };
          } else {
            input = { kind: "numeric", value: failing ? "3.1e9" : `${(1 + rnd() * 9).toFixed(1)}e${5 + Math.floor(rnd() * 3)}` };
          }
          const ev = evaluate(rules, input, {
            expectedPoints: [{ code: "P1", name: "Extremo izquierdo", required: true }, { code: "P2", name: "Centro", required: true }, { code: "P3", name: "Extremo derecho", required: true }],
          });
          const at = new Date(Date.now() - daysAgo * 86400000 - Math.floor(rnd() * 8) * 3600000);
          const [cv] = await tx`select cv.id, cv.procedure_id from criterion_versions cv join categories c on c.criterion_id = cv.criterion_id join assets a on a.category_id = c.id where a.id = ${a.id} and cv.status = 'active'`;
          const by = techs[Math.floor(rnd() * 2)];
          const instSnap = a.inst ? { code: a.inst === i3 ? "PUL-T1" : "MEG-01", calibration_valid: true, status: "active" } : null;
          const [m] = await tx`insert into measurements(org_id, client_id, asset_id, category_id, instrument_id, instrument_snapshot, procedure_id, procedure_revision, criterion_version_id, rules_snapshot,
              method, result, result_explanation, measured_by, recorded_at, measured_at_local, device_timezone, instrument_not_required, comment)
            values (${orgId}, ${randomUUID()}, ${a.id}, (select category_id from assets where id = ${a.id}), ${a.inst}, ${instSnap ? tx.json(instSnap as never) : null}, ${cv?.procedure_id ?? null}, 'A', ${cv?.id ?? null}, ${tx.json(rules as never)},
              ${input.kind}, ${ev.result}, ${tx.json(ev.reasons as never)}, ${by}, ${at}, ${at}, 'Europe/Madrid', ${!a.inst}, ${"Dato de DEMOSTRACIÓN"}) returning id`;
          let i = 0;
          for (const v of ev.values) {
            await tx`insert into measurement_values(org_id, measurement_id, point_code, point_name, value_kind, raw_input, raw_unit, raw_value, normalized_value, normalized_unit, option_value, checked, required, result, explanation, sort_order)
              values (${orgId}, ${m.id}, ${v.pointCode ?? null}, ${v.pointName ?? null}, ${v.kind}, ${v.rawInput ?? null}, ${v.rawUnit ?? null}, ${v.rawValue ?? null}, ${v.normalizedValue ?? null}, ${v.normalizedUnit ?? null}, ${v.optionValue ?? null}, ${v.checked ?? null}, ${v.required}, ${v.result}, ${v.explanation}, ${i++})`;
          }
          measured++;
          if (ev.result === "fail" && rnd() < 0.7) {
            const [{ v: cnt }] = await tx`insert into org_counters(org_id, key, value) values (${orgId}, ${"nc-" + new Date().getUTCFullYear()}, 1) on conflict (org_id, key) do update set value = org_counters.value + 1 returning value as v`;
            const code = `NC-${new Date().getUTCFullYear()}-${String(cnt).padStart(4, "0")}`;
            const [sev] = await tx`select id from nc_severities where org_id = ${orgId} and key = 'major'`;
            const [nc] = await tx`insert into nonconformities(org_id, code, title, description, severity_id, status, owner_user_id, detected_at, due_on, containment, created_by)
              values (${orgId}, ${code}, ${"No conforme en medición (DEMO)"}, ${ev.reasons.join("\n")}, ${sev.id}, ${rnd() < 0.5 ? "containment" : "open"}, ${mgr}, ${at}, ${new Date(at.getTime() + 30 * 86400000).toISOString().slice(0, 10)}, 'Elemento retirado del puesto (DEMO)', ${by}) returning id`;
            await tx`insert into nc_links(org_id, nc_id, measurement_id, asset_id) values (${orgId}, ${nc.id}, ${m.id}, ${a.id})`;
            await tx`insert into nc_status_history(org_id, nc_id, to_status, changed_by, comment) values (${orgId}, ${nc.id}, 'open', ${by}, 'Creación (DEMO)')`;
          }
        }
      }

      // --- Plano con puntos de suelo y ruta
      const { png, width, height } = demoFloorPlan();
      const storageDir = path.resolve(process.env.STORAGE_DIR ?? "./storage");
      const saveFile = async (buf: Buffer, name: string, kind: string, entityId: string | null) => {
        const id = randomUUID();
        const key = `${orgId}/${new Date().getUTCFullYear()}/${id}.png`;
        await mkdir(path.dirname(path.join(storageDir, key)), { recursive: true });
        await writeFile(path.join(storageDir, key), buf);
        await tx`insert into documents(id, org_id, entity_type, entity_id, kind, file_name, mime_type, size_bytes, sha256, storage_key, uploaded_by)
                 values (${id}, ${orgId}, 'floor_plan', ${entityId}, ${kind}, ${name}, 'image/png', ${buf.length}, ${createHash("sha256").update(buf).digest("hex")}, ${key}, ${mgr})`;
        return id;
      };
      const [plan] = await tx`insert into floor_plans(org_id, title, location_id, owner_user_id, created_by) values (${orgId}, 'Nave 1 – Planta baja (DEMO)', ${nave}, ${mgr}, ${mgr}) returning id`;
      const orig = await saveFile(png, "nave1-demo.png", "plan_original", plan.id);
      const page = await saveFile(png, "nave1-demo-p1.png", "plan_page", plan.id);
      const [ver] = await tx`insert into floor_plan_versions(org_id, plan_id, version, label, original_document_id, page_count, created_by, notes) values (${orgId}, ${plan.id}, 1, 'Edición inicial', ${orig}, 1, ${mgr}, 'Plano esquemático ficticio') returning id`;
      await tx`insert into floor_plan_pages(org_id, version_id, page_number, image_document_id, width_px, height_px) values (${orgId}, ${ver.id}, 1, ${page}, ${width}, ${height})`;
      await tx`update floor_plans set current_version_id = ${ver.id} where id = ${plan.id}`;
      const pts: [number, number, string][] = [];
      for (let r = 0; r < 2; r++) for (let c2 = 0; c2 < 4; c2++) pts.push([0.08 + c2 * 0.11 + 0.02, 0.15 + r * 0.25, epaA]);
      for (let r = 0; r < 2; r++) for (let c2 = 0; c2 < 4; c2++) pts.push([0.56 + c2 * 0.11 + 0.02, 0.15 + r * 0.25, epaB]);
      const pointIds: string[] = [];
      for (const [i, [x, y, l]] of pts.entries()) {
        const [p] = await tx`insert into plan_points(org_id, plan_id, code, name, x, y, point_type, category_id, location_id, route_order, created_by)
          values (${orgId}, ${plan.id}, ${"S-" + String(i + 1).padStart(2, "0")}, ${"Punto de suelo " + (i + 1)}, ${x}, ${y}, 'measurement', ${sue.id}, ${l}, ${i + 1}, ${mgr}) returning id`;
        pointIds.push(p.id);
      }
      // Mediciones de algunos puntos de suelo
      for (const [i, pid] of pointIds.entries()) {
        if (i % 3 === 2) continue;
        const input = { kind: "numeric" as const, value: i === 4 ? "1.8e9" : `${(2 + i).toFixed(1)}e7` };
        const ev = evaluate(rtg, input);
        const at = new Date(Date.now() - (40 - i) * 86400000);
        const [cv] = await tx`select id from criterion_versions where criterion_id = ${cRtg} and status = 'active'`;
        const [m] = await tx`insert into measurements(org_id, client_id, plan_point_id, category_id, instrument_id, procedure_id, procedure_revision, criterion_version_id, rules_snapshot, method, result, result_explanation, measured_by, recorded_at, comment)
          values (${orgId}, ${randomUUID()}, ${pid}, ${sue.id}, ${i1}, ${pRtg}, 'A', ${cv.id}, ${tx.json(rtg as never)}, 'numeric', ${ev.result}, ${tx.json(ev.reasons as never)}, ${techs[0]}, ${at}, 'Dato de DEMOSTRACIÓN') returning id`;
        const v = ev.values[0];
        await tx`insert into measurement_values(org_id, measurement_id, value_kind, raw_input, raw_unit, raw_value, normalized_value, normalized_unit, required, result, explanation)
          values (${orgId}, ${m.id}, 'numeric', ${v.rawInput ?? null}, ${v.rawUnit ?? null}, ${v.rawValue ?? null}, ${v.normalizedValue ?? null}, ${v.normalizedUnit ?? null}, true, ${v.result}, ${v.explanation})`;
      }

      // --- Campañas
      const [c1] = await tx`insert into campaigns(org_id, code, name, description, location_id, starts_on, ends_on, owner_user_id, status, creation_mode, created_by)
        values (${orgId}, 'CMP-0001', 'Revisión trimestral Zona EPA A (DEMO)', 'Tapetes, sillas, mesas y pulseras de la zona A', ${epaA}, current_date - 5, current_date + 20, ${mgr}, 'in_progress', 'location', ${mgr}) returning id`;
      let ord = 0;
      for (const a of assets.filter((x) => lines.slice(0, 4).includes(x.loc))) {
        await tx`insert into campaign_items(org_id, campaign_id, asset_id, sort_order) values (${orgId}, ${c1.id}, ${a.id}, ${ord++})`;
      }
      for (const t of techs) await tx`insert into campaign_technicians(org_id, campaign_id, user_id) values (${orgId}, ${c1.id}, ${t})`;
      const [c2] = await tx`insert into campaigns(org_id, code, name, description, location_id, plan_id, starts_on, ends_on, owner_user_id, status, creation_mode, created_by)
        values (${orgId}, 'CMP-0002', 'Medición anual de suelos Nave 1 (DEMO)', 'Recorrido por los puntos del plano', ${nave}, ${plan.id}, current_date + 10, current_date + 25, ${mgr}, 'planned', 'plan', ${mgr}) returning id`;
      ord = 0;
      for (const pid of pointIds) await tx`insert into campaign_items(org_id, campaign_id, plan_point_id, sort_order) values (${orgId}, ${c2.id}, ${pid}, ${ord++})`;
      await tx`insert into campaign_technicians(org_id, campaign_id, user_id) values (${orgId}, ${c2.id}, ${techs[0]})`;
      await tx`insert into org_counters(org_id, key, value) values (${orgId}, 'campaign', 2) on conflict (org_id, key) do update set value = 2`;
      await tx`insert into audit_log(org_id, action, entity_type, entity_id, summary) values (${orgId}, 'seed', 'organization', ${orgId}, ${`Datos de demostración generados (${measured} mediciones)`})`;
      console.log(`Demo creada: ${assets.length} activos, ${measured} mediciones, ${pointIds.length} puntos de plano.`);
    });
    console.log("Usuarios demo (contraseña = DEMO_PASSWORD): admin@, responsable@, tecnico@, tecnico2@, auditor@, consulta@demo.local");
  } finally {
    await sql.end();
  }
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main().catch((e) => {
  console.error("Error en el seed de demo:", e);
  process.exit(1);
});
