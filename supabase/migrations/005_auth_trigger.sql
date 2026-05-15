-- Auto-create public.users profile the moment a new auth user signs up.
-- This replaces the client-side ensureUserProfile upsert as the authoritative
-- profile creation path. New users always get role = 'team_member'.
-- Admins must be promoted manually: UPDATE public.users SET role = 'admin' WHERE email = '...';

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1),
      'Unknown'
    ),
    'team_member'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Backfill: create profiles for any auth users who don't have one yet.
-- This fixes existing users (e.g. Diego) who signed up before the trigger existed.
INSERT INTO public.users (id, email, name, role)
SELECT
  au.id,
  au.email,
  COALESCE(
    au.raw_user_meta_data->>'name',
    split_part(au.email, '@', 1),
    'Unknown'
  ),
  'team_member'
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- ── Promote admins ────────────────────────────────────────────────────────────
-- Run this after the backfill. Replace with the real email addresses.
-- UPDATE public.users SET role = 'admin' WHERE email IN ('demian@oaki.studio', 'diego@oaki.studio');
