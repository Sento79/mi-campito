import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { withCtx } from "@/lib/server/db";

export const GET = api({ permission: "read" }, async (req, s) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ hits: [] });
  const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const hits = await withCtx(s, async (tx) => {
    const [assets, locs, camps, insts, ncs, plans] = await Promise.all([
      tx`select id, code, name, serial_number, scan_code from assets
          where code ilike ${like} or name ilike ${like} or serial_number ilike ${like} or scan_code ilike ${like}
          order by (upper(code) = upper(${q}) or scan_code = ${q}) desc, code limit 8`,
      tx`select id, code, name, kind from locations where code ilike ${like} or name ilike ${like} order by name limit 5`,
      tx`select id, code, name from campaigns where code ilike ${like} or name ilike ${like} order by starts_on desc limit 5`,
      tx`select id, code, type, serial_number from instruments where code ilike ${like} or serial_number ilike ${like} or type ilike ${like} or model ilike ${like} limit 5`,
      tx`select id, code, title from nonconformities where code ilike ${like} or title ilike ${like} order by created_at desc limit 5`,
      tx`select id, title from floor_plans where title ilike ${like} and archived_at is null limit 5`,
    ]);
    return [
      ...assets.map((a) => ({ type: "asset", id: a.id, title: `${a.code} · ${a.name}`, subtitle: [a.serial_number && `S/N ${a.serial_number}`, a.scan_code !== a.code && `QR ${a.scan_code}`].filter(Boolean).join(" · "), href: `/inventario/${a.id}` })),
      ...locs.map((l) => ({ type: "location", id: l.id, title: l.name, subtitle: l.code, href: `/inventario?location=${l.id}` })),
      ...camps.map((c) => ({ type: "campaign", id: c.id, title: c.name, subtitle: c.code, href: `/campanas/${c.id}` })),
      ...insts.map((i) => ({ type: "instrument", id: i.id, title: `${i.code} · ${i.type}`, subtitle: i.serial_number ? `S/N ${i.serial_number}` : undefined, href: `/instrumentos/${i.id}` })),
      ...ncs.map((n) => ({ type: "nc", id: n.id, title: `${n.code} · ${n.title}`, href: `/no-conformidades/${n.id}` })),
      ...plans.map((p) => ({ type: "plan", id: p.id, title: p.title, href: `/planos/${p.id}` })),
    ];
  });
  return NextResponse.json({ hits });
});
