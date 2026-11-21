"use client";
/**
 * Gráficas del dashboard. Los colores son de ESTADO (conforme / no conforme /
 * otros / sin medir), siempre acompañados de leyenda con texto y de tabla
 * alternativa, nunca solo color.
 */
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const C = { pass: "var(--ok)", fail: "var(--bad)", other: "var(--warn)", none: "var(--border-strong)" };
const LABEL = { pass: "Conforme", fail: "No conforme", other: "Revisión / incompleto / otros", none: "Sin medir" };

const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)" };
const axisTick = { fill: "var(--text-muted)", fontSize: 11 };

export function TrendChart({ data }: { data: { week: string; pass: number; fail: number; other: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: new Date(d.week + "T12:00:00Z").toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) }));
  return (
    <figure aria-label="Mediciones por semana y resultado">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap="25%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-2)" }} formatter={(v, n) => [v as number, LABEL[n as keyof typeof LABEL] ?? n]} labelFormatter={(l) => `Semana del ${l}`} />
            <Legend formatter={(v) => <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{LABEL[v as keyof typeof LABEL]}</span>} iconType="circle" iconSize={8} />
            <Bar dataKey="pass" stackId="a" fill={C.pass} stroke="var(--surface)" strokeWidth={2} />
            <Bar dataKey="other" stackId="a" fill={C.other} stroke="var(--surface)" strokeWidth={2} />
            <Bar dataKey="fail" stackId="a" fill={C.fail} stroke="var(--surface)" strokeWidth={2} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer">Ver tabla de datos</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr><th className="py-1">Semana</th><th>Conformes</th><th>No conformes</th><th>Otros</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.week} className="border-t border-line"><td className="py-1">{r.label}</td><td>{r.pass}</td><td>{r.fail}</td><td>{r.other}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function CategoryChart({ data }: { data: { name: string; pass: number; fail: number; other: number; none: number }[] }) {
  return (
    <figure aria-label="Último resultado por categoría">
      <div style={{ height: Math.max(160, data.length * 34 + 60) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }} barCategoryGap="28%">
            <CartesianGrid horizontal={false} stroke="var(--border)" />
            <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={140} tick={axisTick} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-2)" }} formatter={(v, n) => [v as number, LABEL[n as keyof typeof LABEL] ?? n]} />
            <Legend formatter={(v) => <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{LABEL[v as keyof typeof LABEL]}</span>} iconType="circle" iconSize={8} />
            <Bar dataKey="pass" stackId="a" fill={C.pass} stroke="var(--surface)" strokeWidth={2} />
            <Bar dataKey="other" stackId="a" fill={C.other} stroke="var(--surface)" strokeWidth={2} />
            <Bar dataKey="fail" stackId="a" fill={C.fail} stroke="var(--surface)" strokeWidth={2} />
            <Bar dataKey="none" stackId="a" fill={C.none} stroke="var(--surface)" strokeWidth={2} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
