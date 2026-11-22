"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus, KeyRound, Pencil, ShieldPlus, Check } from "lucide-react";
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, Select, Table, Td, Th } from "@/components/ui/core";
import { Modal, useAction } from "@/components/ui/client";
import { PERMISSIONS, PERMISSION_LABEL } from "@/lib/domain/permissions";
import { fmtDateTime } from "@/lib/format";
import { createUserAction, resetPasswordAction, saveRoleAction, updateMembershipAction } from "./actions";

type U = { id: string; email: string; name: string; lastLogin: string | null; locked: boolean; active: boolean; roleId: string; roleName: string };
type R = { id: string; key: string; name: string; description: string | null; isSystem: boolean; permissions: string[]; members: number };

export function UsersAdmin({ me, users, roles }: { me: string; users: U[]; roles: R[] }) {
  const router = useRouter();
  const [newUser, setNewUser] = React.useState(false);
  const [nu, setNu] = React.useState({ email: "", fullName: "", password: "", roleId: roles.find((r) => r.key === "technician")?.id ?? roles[0]?.id });
  const [edit, setEdit] = React.useState<U | null>(null);
  const [pwFor, setPwFor] = React.useState<U | null>(null);
  const [pw, setPw] = React.useState("");
  const [role, setRole] = React.useState<R | null>(null);
  const [errs, setErrs] = React.useState<Record<string, string>>({});
  const create = useAction(createUserAction);
  const upd = useAction(updateMembershipAction);
  const reset = useAction(resetPasswordAction);
  const saveRole = useAction(saveRoleAction);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={`Usuarios (${users.length})`} actions={<Button size="sm" icon={UserPlus} onClick={() => { setNewUser(true); setErrs({}); }}>Añadir usuario</Button>} />
        <Table>
          <thead><tr><Th>Nombre</Th><Th>Correo</Th><Th>Rol</Th><Th>Estado</Th><Th>Último acceso</Th><Th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? "" : "opacity-55"}>
                <Td className="font-medium">{u.name}{u.id === me ? <Badge className="ml-2" tone="info">Usted</Badge> : null}</Td>
                <Td className="text-muted">{u.email}</Td>
                <Td><Badge tone="primary">{u.roleName}</Badge></Td>
                <Td>{!u.active ? <Badge>Desactivado</Badge> : u.locked ? <Badge tone="bad">Bloqueado (intentos)</Badge> : <Badge tone="ok">Activo</Badge>}</Td>
                <Td className="text-xs text-muted">{u.lastLogin ? fmtDateTime(u.lastLogin) : "Nunca"}</Td>
                <Td className="whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Editar ${u.name}`} onClick={() => setEdit(u)} />
                  <Button size="sm" variant="ghost" icon={KeyRound} aria-label={`Restablecer contraseña de ${u.name}`} onClick={() => { setPwFor(u); setPw(""); setErrs({}); }} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card>
        <CardHeader title="Roles y permisos" actions={<Button size="sm" variant="outline" icon={ShieldPlus} onClick={() => setRole({ id: "", key: "", name: "", description: "", isSystem: false, permissions: ["read"], members: 0 })}>Nuevo rol</Button>} />
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="sticky left-0 bg-surface px-4 py-2 text-left text-xs font-semibold text-muted">Permiso</th>{roles.map((r) => <th key={r.id} className="px-3 py-2 text-center text-xs font-semibold"><button className="hover:text-primary hover:underline" onClick={() => setRole(r)} disabled={r.key === "admin"}>{r.name}</button><span className="block font-normal text-faint">{r.members} usuario(s)</span></th>)}</tr></thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p} className="border-t border-line">
                  <td className="sticky left-0 bg-surface px-4 py-1.5">{PERMISSION_LABEL[p]}</td>
                  {roles.map((r) => <td key={r.id} className="text-center">{r.permissions.includes(p) ? <Check className="mx-auto size-4 text-ok" aria-label="Sí" /> : <span className="text-faint" aria-label="No">·</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={newUser} onClose={() => setNewUser(false)} title="Añadir usuario" description="Comunique la contraseña inicial por un canal seguro; el usuario puede cambiarla en «Mi perfil»."
        footer={<><Button variant="ghost" onClick={() => setNewUser(false)}>Cancelar</Button><Button loading={create.pending} onClick={async () => { const r = await create.run(nu as never, { success: "Usuario añadido" }); if (r && !r.ok) setErrs(r.fieldErrors ?? {}); if (r?.ok) { setNewUser(false); setNu({ ...nu, email: "", fullName: "", password: "" }); router.refresh(); } }}>Añadir</Button></>}>
        <div className="space-y-4">
          <Field label="Nombre completo" htmlFor="nu-name" required error={errs.fullName}><Input id="nu-name" value={nu.fullName} onChange={(e) => setNu({ ...nu, fullName: e.target.value })} /></Field>
          <Field label="Correo" htmlFor="nu-email" required error={errs.email}><Input id="nu-email" type="email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} /></Field>
          <Field label="Contraseña inicial" htmlFor="nu-pw" required error={errs.password} hint="Mín. 10 caracteres con 3 tipos (minúsculas, mayúsculas, números, símbolos)"><Input id="nu-pw" type="password" autoComplete="new-password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /></Field>
          <Field label="Rol" htmlFor="nu-role"><Select id="nu-role" value={nu.roleId} onChange={(e) => setNu({ ...nu, roleId: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
        </div>
      </Modal>
      {edit ? <EditMembership u={edit} roles={roles} me={me} loading={upd.pending} onClose={() => setEdit(null)} onSave={async (v) => { const r = await upd.run({ userId: edit.id, ...v }, { success: "Usuario actualizado" }); if (r?.ok) { setEdit(null); router.refresh(); } }} /> : null}
      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title={`Restablecer contraseña de ${pwFor?.name}`} description="Se cerrarán todas sus sesiones abiertas." footer={<><Button variant="ghost" onClick={() => setPwFor(null)}>Cancelar</Button><Button loading={reset.pending} onClick={async () => { const r = await reset.run({ userId: pwFor!.id, password: pw }, { success: "Contraseña restablecida" }); if (r && !r.ok) setErrs(r.fieldErrors ?? {}); if (r?.ok) setPwFor(null); }}>Restablecer</Button></>}>
        <Field label="Nueva contraseña" htmlFor="rp-pw" error={errs.password}><Input id="rp-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      </Modal>
      {role ? (
        <Modal open onClose={() => setRole(null)} title={role.id ? `Permisos de ${role.name}` : "Nuevo rol"} size="lg" footer={<><Button variant="ghost" onClick={() => setRole(null)}>Cancelar</Button><Button loading={saveRole.pending} onClick={async () => { const r = await saveRole.run({ id: role.id || null, key: role.key, name: role.name, description: role.description || null, permissions: role.permissions as never }, { success: "Rol guardado" }); if (r?.ok) { setRole(null); router.refresh(); } }}>Guardar</Button></>}>
          {!role.id || !role.isSystem ? (
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {!role.id ? <Field label="Clave" htmlFor="ro-key" hint="p. ej. supervisor_linea"><Input id="ro-key" className="font-mono" value={role.key} onChange={(e) => setRole({ ...role, key: e.target.value })} /></Field> : null}
              <Field label="Nombre" htmlFor="ro-name"><Input id="ro-name" value={role.name} onChange={(e) => setRole({ ...role, name: e.target.value })} /></Field>
            </div>
          ) : <p className="mb-3 text-sm text-muted">Rol del sistema: puede ajustar sus permisos.</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PERMISSIONS.map((p) => <Checkbox key={p} label={PERMISSION_LABEL[p]} checked={role.permissions.includes(p)} onChange={(e) => setRole({ ...role, permissions: e.target.checked ? [...role.permissions, p] : role.permissions.filter((x) => x !== p) })} />)}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function EditMembership({ u, roles, me, loading, onClose, onSave }: { u: U; roles: R[]; me: string; loading: boolean; onClose: () => void; onSave: (v: { roleId: string; isActive: boolean; reason: string | null }) => void }) {
  const [v, setV] = React.useState({ roleId: u.roleId, isActive: u.active, reason: "" });
  const self = u.id === me;
  return (
    <Modal open onClose={onClose} title={`Editar ${u.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={loading} onClick={() => onSave({ ...v, reason: v.reason || null })}>Guardar</Button></>}>
      <div className="space-y-4">
        <Field label="Rol" htmlFor="em-role" hint={self ? "No puede cambiar su propio rol" : undefined}><Select id="em-role" disabled={self} value={v.roleId} onChange={(e) => setV({ ...v, roleId: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
        <Checkbox label="Acceso activo (al desactivar se cierran sus sesiones)" disabled={self} checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />
        <Field label="Motivo" htmlFor="em-reason"><Input id="em-reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
