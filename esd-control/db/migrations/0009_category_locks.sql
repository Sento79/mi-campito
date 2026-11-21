-- =====================================================================
-- 0009: bloqueo de categorías al editar un activo.
-- SELECT ... FOR SHARE aplica las políticas RLS de UPDATE; en categories exigen criteria.manage, así
-- que un rol que solo edita activos no llegaba a bloquear nada. Esta función (SECURITY DEFINER)
-- bloquea las categorías indicadas de la organización actual, en orden de id, a quien puede editar.
-- Orden resultante: categoría → activo, el mismo que sigue categories_period_changed.
-- =====================================================================
create or replace function app_lock_categories(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if app_current_org() is null or not app_has_permission('edit') then
    raise exception 'Permiso denegado' using errcode = '42501';
  end if;
  perform 1 from categories where id = any(p_ids) and org_id = app_current_org() order by id for share;
end $$;
revoke execute on function app_lock_categories(uuid[]) from public;
