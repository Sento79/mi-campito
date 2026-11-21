import "server-only";
import type { Tx } from "./db";
import type { SessionInfo } from "./auth";
import { storage } from "./storage";
import type { ReportMeta } from "./pdf";

/** Datos comunes de cabecera de informe (logo configurable, empresa, pie). */
export async function reportMeta(tx: Tx, s: SessionInfo, title: string, extra: Partial<ReportMeta> = {}): Promise<ReportMeta> {
  let logo: Buffer | null = null;
  const logoId = s.org.settings.company.logoDocumentId;
  if (logoId) {
    const [d] = await tx`select storage_key from documents where id = ${logoId}`;
    if (d) logo = await storage().get(d.storage_key).catch(() => null);
  }
  return {
    title,
    orgName: s.org.settings.company.displayName || s.org.name,
    generatedBy: `${s.user.fullName} (${s.role.name})`,
    footer: s.org.settings.company.reportFooter || undefined,
    logo,
    isDemo: s.org.isDemo,
    ...extra,
  };
}
