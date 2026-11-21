import {
  LayoutDashboard,
  ScanLine,
  Boxes,
  Map,
  CalendarRange,
  History,
  ShieldAlert,
  Gauge,
  Tags,
  FileBarChart,
  Bell,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/domain/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  children?: { href: string; label: string; permission?: Permission }[];
}

export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/medicion", label: "Medición rápida", icon: ScanLine, permission: "measure" },
  {
    href: "/inventario",
    label: "Inventario",
    icon: Boxes,
    children: [
      { href: "/inventario", label: "Todos los activos" },
      { href: "/inventario/categorias", label: "Categorías" },
      { href: "/inventario/ubicaciones", label: "Ubicaciones" },
    ],
  },
  { href: "/planos", label: "Planos", icon: Map },
  { href: "/campanas", label: "Campañas", icon: CalendarRange },
  { href: "/historial", label: "Historial", icon: History },
  { href: "/no-conformidades", label: "No conformidades", icon: ShieldAlert },
  { href: "/instrumentos", label: "Instrumentos", icon: Gauge },
  { href: "/etiquetas", label: "Etiquetas", icon: Tags },
  { href: "/informes", label: "Informes", icon: FileBarChart, permission: "reports" },
  { href: "/alertas", label: "Alertas", icon: Bell },
  {
    href: "/admin",
    label: "Administración",
    icon: Settings2,
    children: [
      { href: "/admin/plantas", label: "Plantas y zonas" },
      { href: "/admin/criterios", label: "Criterios y procedimientos" },
      { href: "/admin/usuarios", label: "Usuarios y roles", permission: "users.manage" },
      { href: "/admin/configuracion", label: "Configuración", permission: "settings.manage" },
      { href: "/admin/auditoria", label: "Auditoría", permission: "audit.read" },
    ],
  },
];

/** Etiquetas para migas de pan por segmento. */
export const SEGMENT_LABEL: Record<string, string> = {
  medicion: "Medición rápida",
  inventario: "Inventario",
  categorias: "Categorías",
  ubicaciones: "Ubicaciones",
  importar: "Importar",
  nuevo: "Nuevo",
  nueva: "Nueva",
  editar: "Editar",
  planos: "Planos",
  campanas: "Campañas",
  historial: "Historial",
  "no-conformidades": "No conformidades",
  instrumentos: "Instrumentos",
  etiquetas: "Etiquetas",
  informes: "Informes",
  alertas: "Alertas",
  admin: "Administración",
  plantas: "Plantas y zonas",
  criterios: "Criterios y procedimientos",
  usuarios: "Usuarios y roles",
  configuracion: "Configuración",
  auditoria: "Auditoría",
  perfil: "Mi perfil",
  procedimientos: "Procedimientos",
};
