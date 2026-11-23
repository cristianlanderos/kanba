-- Applied after the migrations of supabase/migrations. It closes what they leave open to
-- someone who is not signed in, or not a member.

-- Nobody reads the database without signing in. The one public page, a board shared by
-- link, is served by the app's server (app/api/share), which checks the link's token.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- These two views read with their owner's rights, so they showed every project's members,
-- with their emails, to any signed-in user. Now they read as whoever asks, and the row
-- level security policies of the tables under them apply.
ALTER VIEW public.project_members_with_profiles SET (security_invoker = true);
ALTER VIEW public.user_project_access SET (security_invoker = true);
