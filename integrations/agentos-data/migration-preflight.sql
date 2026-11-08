-- Read-only destination metadata for the linked AgentOS project.
-- No row payloads, credentials, function bodies or production writes.
WITH user_schemas AS (
  SELECT oid, nspname, nspowner, nspacl FROM pg_namespace
  WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
), relations AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.reltuples,
    c.relrowsecurity, c.relforcerowsecurity, c.relowner
  FROM pg_class c JOIN user_schemas n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','S')
), relation_page AS (
  SELECT * FROM relations ORDER BY nspname,relname LIMIT 1000
), api_roles AS (
  SELECT oid,rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
)
SELECT jsonb_build_object(
  'schema', 'agentos.supabase-migration-preflight.v1',
  'requested_project_ref', 'rxcykzhtkspsonntirhi',
  'captured_at', current_timestamp,
  'database', jsonb_build_object(
    'name', current_database(), 'current_role', current_user,
    'server_version', current_setting('server_version'),
    'server_version_num', current_setting('server_version_num'),
    'encoding', current_setting('server_encoding'), 'timezone', current_setting('TimeZone'),
    'database_bytes', pg_database_size(current_database())::text
  ),
  'extensions', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'name', e.extname, 'version', e.extversion, 'schema', n.nspname
  ) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace), '[]'::jsonb),
  'required_extensions_available', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'name', name, 'default_version', default_version, 'installed_version', installed_version
  ) ORDER BY name) FROM pg_available_extensions WHERE name IN ('pg_trgm','fuzzystrmatch')), '[]'::jsonb),
  'connection_settings', coalesce((SELECT jsonb_object_agg(name,setting) FROM pg_settings
    WHERE name IN ('max_connections','superuser_reserved_connections','reserved_connections',
      'statement_timeout','idle_in_transaction_session_timeout','max_locks_per_transaction')), '{}'::jsonb),
  -- Deliberately select only these non-secret settings, never whole role config.
  -- Role overrides alone do not establish the effective PostgREST API config.
  'postgrest_role_overrides', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'role', r.rolname, 'database', coalesce(d.datname,'all'), 'setting', value
  ) ORDER BY r.rolname,d.datname,value)
    FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole
    LEFT JOIN pg_database d ON d.oid=s.setdatabase
    CROSS JOIN LATERAL unnest(s.setconfig) AS config(value)
    WHERE r.rolname='authenticator' AND split_part(value,'=',1)
      IN ('pgrst.db_schemas','pgrst.db_extra_search_path','pgrst.db_anon_role')), '[]'::jsonb),
  'api_default_privileges', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'owner', pg_get_userbyid(d.defaclrole), 'schema', coalesce(n.nspname,'all'),
    'object_type', d.defaclobjtype, 'grantee', coalesce(r.rolname,'PUBLIC'),
    'privilege', a.privilege_type, 'grantable', a.is_grantable
  ) ORDER BY d.defaclrole,n.nspname,d.defaclobjtype,a.grantee,a.privilege_type)
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
    WHERE a.grantee=0 OR r.rolname IN ('anon','authenticated','service_role')), '[]'::jsonb),
  'schemas', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'name', n.nspname, 'owner', pg_get_userbyid(n.nspowner),
    'public_privileges', coalesce((SELECT jsonb_agg(a.privilege_type ORDER BY a.privilege_type)
      FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee=0), '[]'::jsonb),
    'api_roles', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'role', r.rolname, 'usage', has_schema_privilege(r.oid,n.oid,'USAGE'),
      'create', has_schema_privilege(r.oid,n.oid,'CREATE')
    ) ORDER BY r.rolname) FROM api_roles r), '[]'::jsonb),
    'functions', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=n.oid)
  ) ORDER BY n.nspname) FROM user_schemas n), '[]'::jsonb),
  'relation_count', (SELECT count(*) FROM relations),
  'relations_truncated', (SELECT count(*)>1000 FROM relations),
  'relations', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'schema', t.nspname, 'name', t.relname, 'kind', t.relkind,
    'owner', pg_get_userbyid(t.relowner), 'approximate_rows', t.reltuples,
    'bytes', CASE WHEN t.relkind IN ('r','p','m') THEN pg_total_relation_size(t.oid)::text ELSE NULL END,
    'rls_enabled', t.relrowsecurity, 'rls_forced', t.relforcerowsecurity,
    'api_roles', CASE WHEN t.relkind IN ('r','p','v','m') THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'role', r.rolname, 'select', has_table_privilege(r.oid,t.oid,'SELECT'),
      'insert', has_table_privilege(r.oid,t.oid,'INSERT'),
      'update', has_table_privilege(r.oid,t.oid,'UPDATE'),
      'delete', has_table_privilege(r.oid,t.oid,'DELETE')
    ) ORDER BY r.rolname) FROM api_roles r), '[]'::jsonb) ELSE '[]'::jsonb END
  ) ORDER BY t.nspname,t.relname) FROM relation_page t), '[]'::jsonb),
  'limits', jsonb_build_object(
    'row_counts', 'planner_estimates_only', 'source_inventory', 'not_performed',
    'data_api_configuration', 'requires_dashboard_or_management_api_verification',
    'connector_permissions', 'requires_native_AgentOS_verification',
    'backup_restore', 'not_performed', 'migration_or_activation', 'not_performed'
  )
) AS preflight;
