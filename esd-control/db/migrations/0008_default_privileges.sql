-- =====================================================================
-- 0008: privilegios por defecto globales.
-- `alter default privileges in schema public ...` (0007) no puede retirar el EXECUTE que el valor
-- global concede a PUBLIC: los privilegios por esquema solo se suman a los globales. Se retira en el
-- valor global del rol propietario. El migrador también lo hace antes de cada ejecución, y
-- grants.sql revoca y concede de forma explícita las funciones ya existentes.
-- =====================================================================
alter default privileges revoke execute on functions from public;
revoke execute on all functions in schema public from public;
