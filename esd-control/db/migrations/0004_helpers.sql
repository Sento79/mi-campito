-- 0004: funciones auxiliares de consulta (jerarquía de ubicaciones).
-- Se ejecutan con los permisos del invocador, por lo que RLS sigue aplicando.

create or replace function app_location_subtree(p_root uuid) returns setof uuid
language sql stable as $$
  with recursive t(id) as (
    select id from locations where id = p_root
    union all
    select l.id from locations l join t on l.parent_id = t.id
  ) select id from t
$$;

create or replace function app_location_path(p_id uuid) returns text
language sql stable as $$
  -- Ruta legible sin el nodo raíz de tipo 'company' (p. ej. "Planta VLC › Nave 2 › Línea 3")
  with recursive t(id, parent_id, name, kind, depth) as (
    select id, parent_id, name, kind, 0 from locations where id = p_id
    union all
    select l.id, l.parent_id, l.name, l.kind, t.depth + 1 from locations l join t on l.id = t.parent_id where t.depth < 12
  )
  select coalesce(string_agg(name, ' › ' order by depth desc) filter (where kind <> 'company' or depth = 0), '') from t
$$;

grant execute on function app_location_subtree(uuid), app_location_path(uuid) to esd_app;
