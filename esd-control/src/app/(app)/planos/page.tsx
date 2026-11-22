import Link from "@/components/link";
import { Plus, Map } from "lucide-react";
import { requirePermission } from "@/lib/server/auth";
import { withCtx } from "@/lib/server/db";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui/core";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Planos" };

export default async function Plans() {
  const s = await requirePermission("read");
  const rows = await withCtx(s, (tx) => tx`
    select p.id, p.title, app_location_path(p.location_id) as location, v.version, v.label, v.effective_on, pg.image_document_id,
      (select count(*)::int from plan_points pp where pp.plan_id = p.id and pp.archived_at is null) as points,
      (select count(*)::int from plan_points pp where pp.plan_id = p.id and pp.archived_at is null and pp.last_result = 'pass') as pass,
      (select count(*)::int from plan_points pp where pp.plan_id = p.id and pp.archived_at is null and pp.last_result = 'fail') as fail,
      (select count(*)::int from plan_points pp where pp.plan_id = p.id and pp.archived_at is null and pp.last_result is null and pp.point_type <> 'reference') as pending,
      (select code from campaigns c where c.plan_id = p.id and c.status = 'in_progress' limit 1) as active_campaign
    from floor_plans p left join floor_plan_versions v on v.id = p.current_version_id
    left join floor_plan_pages pg on pg.version_id = v.id and pg.page_number = 1
    where p.archived_at is null order by p.title`);
  return (
    <>
      <PageHeader title="Planos de planta" description="Planos interactivos con puntos de medición georreferenciados en coordenadas normalizadas." actions={s.permissions.has("create") ? <ButtonLink href="/planos/nuevo" icon={Plus}>Nuevo plano</ButtonLink> : null} />
      {rows.length === 0 ? (
        <Card><EmptyState icon={Map} title="Aún no hay planos" description="Suba un plano en PDF, PNG o JPG para empezar a colocar puntos." action={s.permissions.has("create") ? <ButtonLink href="/planos/nuevo" icon={Plus}>Nuevo plano</ButtonLink> : undefined} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <Link key={p.id} href={`/planos/${p.id}`} className="group overflow-hidden rounded-lg border border-line bg-surface shadow-card transition-colors hover:border-primary/50">
              <div className="aspect-[16/10] overflow-hidden border-b border-line bg-surface-2">
                {p.image_document_id ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${p.image_document_id}`} alt="" className="size-full object-contain transition-transform group-hover:scale-[1.02]" loading="lazy" />
                ) : null}
              </div>
              <div className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{p.title}</p>
                  {p.active_campaign ? <Badge tone="info">En campaña {p.active_campaign}</Badge> : null}
                </div>
                <p className="text-xs text-muted">{p.location || "Sin ubicación"} · v{p.version}{p.label ? ` (${p.label})` : ""} · vigente desde {fmtDate(p.effective_on)}</p>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge>{p.points} puntos</Badge>
                  <Badge tone="ok">{p.pass} conformes</Badge>
                  {p.fail ? <Badge tone="bad">{p.fail} no conformes</Badge> : null}
                  {p.pending ? <Badge>{p.pending} sin medir</Badge> : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
