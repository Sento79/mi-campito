-- Permisos del rol de aplicación. Idempotente: scripts/migrate.ts lo ejecuta en CADA
-- migración (también tras restaurar un volcado de otra instalación, donde los GRANT
-- originales pueden no haberse aplicado si el rol no existía).
grant usage on schema public to esd_app;
grant select, insert, update on all tables in schema public to esd_app;
revoke all on sessions, org_counters, schema_migrations from esd_app;
revoke insert, update, delete on audit_log_archive from esd_app;
revoke update, delete on audit_log from esd_app;
revoke insert, update on permissions from esd_app;
revoke all on users from esd_app;
grant select (id, email, full_name, is_active, failed_logins, locked_until, last_login_at, password_changed_at, created_at, updated_at) on users to esd_app;
grant update (full_name, is_active) on users to esd_app;
revoke update on role_permissions from esd_app;
grant delete on measurements, measurement_values, role_permissions, campaign_technicians, campaign_categories,
  campaign_items, notifications, point_template_items, roles, label_templates, criterion_versions to esd_app;
grant usage, select on all sequences in schema public to esd_app;
-- Funciones: solo las que la aplicación invoca o usan las políticas RLS
revoke execute on all functions in schema public from public, esd_app;
grant execute on function
  app_current_org(), app_current_user(), app_has_permission(text), app_is_member(), app_any_permission(text[]), app_user_in_org(uuid),
  app_auth_find_user(text), app_auth_register_attempt(uuid, boolean), app_auth_user_orgs(uuid),
  app_session_create(uuid, uuid, bytea, timestamptz, text, text), app_session_resolve(bytea), app_session_revoke(bytea), app_session_revoke_user(uuid),
  app_auth_set_password(uuid, text), app_user_create(text, text, text, uuid), app_next_counter(text),
  app_location_subtree(uuid), app_location_path(uuid), app_period_interval(text, integer), app_generate_alert_notifications(),
  app_lock_categories(uuid[])
  to esd_app;
