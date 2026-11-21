import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/auth";
import { LoginForm } from "./login-form";
import { Zap } from "lucide-react";

export const metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const s = await getSession();
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (s) redirect(safeNext);
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-text lg:flex">
        <div className="flex items-center gap-3 text-white">
          <span className="grid size-10 place-items-center rounded-lg bg-[#3aa5cc]/15 text-[#3aa5cc]">
            <Zap className="size-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold tracking-tight">ESD Control</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight text-white">Control de protección electrostática con trazabilidad completa.</h1>
          <p className="mt-4 text-sm leading-relaxed">
            Inventario de elementos ESD, medición rápida por escáner, planos de planta, campañas, no conformidades, instrumentos calibrados e
            informes auditables.
          </p>
        </div>
        <p className="text-xs text-sidebar-text/70">Los criterios de aceptación los define el responsable autorizado de cada organización.</p>
        <svg className="pointer-events-none absolute -right-24 -bottom-24 size-[28rem] text-white/[0.03]" viewBox="0 0 100 100" aria-hidden>
          <path d="M56 6 26 56h20l-6 38 34-52H54z" fill="currentColor" />
        </svg>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold">Iniciar sesión</h2>
          <p className="mt-1 text-sm text-muted">Acceda con su cuenta corporativa.</p>
          <LoginForm next={safeNext} />
        </div>
      </section>
    </main>
  );
}
