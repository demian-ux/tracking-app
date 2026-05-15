-- Allow any authenticated user to insert their own profile row.
-- Role is forced to 'team_member' — only admins can elevate via UPDATE.
CREATE POLICY "users: self insert" ON users
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND id = auth.uid()
    AND role = 'team_member'
  );
