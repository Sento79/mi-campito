"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/core";
import { useToast } from "@/components/ui/client";

type Action = (fd: FormData) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

/** Botón de subida de archivo que invoca una Server Action con FormData. */
export function UploadButton({ action, fields, accept = ".pdf,.png,.jpg,.jpeg", label = "Adjuntar", maxMb = 20 }: { action: Action; fields: Record<string, string>; accept?: string; label?: string; maxMb?: number }) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();
  const router = useRouter();
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > maxMb * 1024 * 1024) {
            toast({ tone: "bad", title: `El archivo supera ${maxMb} MB` });
            return;
          }
          const fd = new FormData();
          fd.set("file", f);
          for (const [k, v] of Object.entries(fields)) fd.set(k, v);
          setBusy(true);
          try {
            const r = await action(fd);
            if (r.ok) {
              toast({ tone: "ok", title: "Archivo subido", body: f.name });
              router.refresh();
            } else toast({ tone: "bad", title: r.error });
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button size="sm" variant="outline" icon={Upload} loading={busy} onClick={() => ref.current?.click()}>
        {label}
      </Button>
    </>
  );
}
