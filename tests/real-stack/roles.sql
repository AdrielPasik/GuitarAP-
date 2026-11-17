-- Same job as Supabase's own docker setup: give the service roles a password the other containers know.
alter user authenticator with password 'test-only-password';
alter user supabase_auth_admin with password 'test-only-password';
alter user pgbouncer with password 'test-only-password';
