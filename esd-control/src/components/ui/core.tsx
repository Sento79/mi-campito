import * as React from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { CheckCircle2, XCircle, AlertTriangle, CircleDashed, MinusCircle, Ban, HelpCircle, Inbox, type LucideIcon } from "lucide-react";
import { RESULT_LABEL, RESULT_TONE, type Result } from "@/lib/domain/results";

export const cn = clsx;

// ---------------------------------------------------------------------------
// Botones
// ---------------------------------------------------------------------------
type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
const variantCls: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover border border-transparent",
  secondary: "bg-surface-2 text-fg hover:bg-line border border-line",
  outline: "bg-surface text-fg hover:bg-surface-2 border border-line-strong",
  ghost: "bg-transparent text-fg hover:bg-surface-2 border border-transparent",
  danger: "bg-bad text-white hover:opacity-90 border border-transparent",
};
const sizeCls = { sm: "h-8 px-3 text-sm gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-5 text-base gap-2" };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: keyof typeof sizeCls;
  loading?: boolean;
  icon?: LucideIcon;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon: Icon, className, children, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55 whitespace-nowrap select-none",
        variantCls[variant],
        sizeCls[size],
        className,
      )}
      {...props}
    >
      {loading ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
      {children}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  icon: Icon,
  className,
  children,
  prefetch,
  ...rest
}: { href: string; variant?: Variant; size?: keyof typeof sizeCls; icon?: LucideIcon; className?: string; children: React.ReactNode; prefetch?: boolean } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  // prefetch={false}: enlace "duro" (descargas y rutas /api), sin navegación de cliente
  if (prefetch === false) {
    return (
      <a href={href} className={cn("inline-flex items-center justify-center rounded-md font-medium transition-colors whitespace-nowrap", variantCls[variant], sizeCls[size], className)} {...rest}>
        {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
        {children}
      </a>
    );
  }
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center justify-center rounded-md font-medium transition-colors whitespace-nowrap", variantCls[variant], sizeCls[size], className)}
      {...rest}
    >
      {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------
const fieldBase =
  "w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-faint transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:bg-surface-2 disabled:text-muted aria-[invalid=true]:border-bad";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(fieldBase, "h-10", className)} {...p} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, "py-2 min-h-20", className)} {...p} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, "h-10 pr-8", className)} {...p}>
      {children}
    </select>
  );
});

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
        {label}
        {required ? <span className="ml-0.5 text-bad" aria-hidden>*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-bad" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, className, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm cursor-pointer select-none", className)}>
      <input type="checkbox" className="size-4 rounded border-line-strong accent-[var(--primary)]" {...p} />
      <span>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Contenedores
// ---------------------------------------------------------------------------
export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface shadow-card", className)} {...p}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-line px-5 py-3.5", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions, meta }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-fg md:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: { icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-surface-2 p-3 text-muted">
        <Icon className="size-6" aria-hidden />
      </div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} aria-hidden />;
}

// ---------------------------------------------------------------------------
// Badges y estados (nunca solo color: icono + texto)
// ---------------------------------------------------------------------------
const toneCls = {
  ok: "bg-ok-soft text-ok",
  bad: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn",
  neutral: "bg-neutral-soft text-neutral",
  info: "bg-info-soft text-info",
  primary: "bg-primary-soft text-primary",
};
export type Tone = keyof typeof toneCls;

export function Badge({ tone = "neutral", icon: Icon, children, className, title }: { tone?: Tone; icon?: LucideIcon; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", toneCls[tone], className)}>
      {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {children}
    </span>
  );
}

export const RESULT_ICON: Record<Result, LucideIcon> = {
  pass: CheckCircle2,
  fail: XCircle,
  review: AlertTriangle,
  incomplete: CircleDashed,
  pending: CircleDashed,
  not_measurable: Ban,
  not_applicable: MinusCircle,
};

export function ResultBadge({ result, size = "sm" }: { result: string | null | undefined; size?: "sm" | "lg" }) {
  if (!result) return <Badge tone="neutral" icon={HelpCircle}>Sin medir</Badge>;
  const r = result as Result;
  const Icon = RESULT_ICON[r] ?? HelpCircle;
  if (size === "lg") {
    return (
      <span className={cn("inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-base font-semibold", toneCls[RESULT_TONE[r] ?? "neutral"])}>
        <Icon className="size-5" aria-hidden />
        {RESULT_LABEL[r] ?? r}
      </span>
    );
  }
  return (
    <Badge tone={RESULT_TONE[r] ?? "neutral"} icon={Icon}>
      {RESULT_LABEL[r] ?? r}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th scope="col" className={cn("border-b border-line bg-surface-2/60 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted whitespace-nowrap", className)} {...p}>
      {children}
    </th>
  );
}
export function Td({ children, className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("border-b border-line px-4 py-2.5 align-middle text-fg", className)} {...p}>
      {children}
    </td>
  );
}

export function Kpi({ label, value, hint, href, tone, icon: Icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; tone?: Tone; icon?: LucideIcon }) {
  const body = (
    <div className="flex h-full flex-col justify-between gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
        {Icon ? (
          <span className={cn("rounded-md p-1.5", tone ? toneCls[tone] : "bg-surface-2 text-muted")}>
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="text-2xl font-semibold tabular text-fg">{value}</div>
      {hint ? <div className="text-xs text-muted">{hint}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-lg border border-line bg-surface shadow-card transition-colors hover:border-primary/50 hover:bg-surface-2/40">
      {body}
    </Link>
  ) : (
    <Card>{body}</Card>
  );
}

export function DefinitionList({ items, cols = 2 }: { items: [string, React.ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-sm", cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3")}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-fg">{v ?? <span className="text-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Alert({ tone = "info", title, children, icon: Icon }: { tone?: Tone; title?: string; children?: React.ReactNode; icon?: LucideIcon }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", toneCls[tone], "border-current/15")}>
      {Icon ? <Icon className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5", "text-fg/85")}>{children}</div> : null}
      </div>
    </div>
  );
}
