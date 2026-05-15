-- Row Level Security

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE view_stage_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_events ENABLE ROW LEVEL SECURITY;

-- Helper: current user role (SECURITY DEFINER bypasses RLS on users table)
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS user_role AS $$
  SELECT role FROM public.users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── users ────────────────────────────────────────────────────────────────────
-- Any authenticated user can read their own row (no role dependency)
CREATE POLICY "users: read own" ON users
  FOR SELECT USING (auth.uid() IS NOT NULL AND id = auth.uid());

-- Admins can read all user rows
CREATE POLICY "users: admin read all" ON users
  FOR SELECT USING (current_user_role() = 'admin');

-- Admins can insert/update/delete users
CREATE POLICY "users: admin write" ON users
  FOR ALL USING (current_user_role() = 'admin');

-- ── clients ───────────────────────────────────────────────────────────────────
CREATE POLICY "clients: admin all" ON clients
  FOR ALL USING (current_user_role() = 'admin');

CREATE POLICY "clients: team read" ON clients
  FOR SELECT USING (current_user_role() IN ('admin', 'team_member'));

-- ── projects ──────────────────────────────────────────────────────────────────
CREATE POLICY "projects: admin all" ON projects
  FOR ALL USING (current_user_role() = 'admin');

CREATE POLICY "projects: team read active" ON projects
  FOR SELECT USING (
    current_user_role() = 'team_member' AND status != 'archived'
  );

-- ── project_views ─────────────────────────────────────────────────────────────
CREATE POLICY "project_views: admin all" ON project_views
  FOR ALL USING (current_user_role() = 'admin');

CREATE POLICY "project_views: team read" ON project_views
  FOR SELECT USING (current_user_role() IN ('admin', 'team_member'));

-- ── delivery_rounds ───────────────────────────────────────────────────────────
CREATE POLICY "delivery_rounds: admin all" ON delivery_rounds
  FOR ALL USING (current_user_role() = 'admin');

CREATE POLICY "delivery_rounds: team read" ON delivery_rounds
  FOR SELECT USING (current_user_role() IN ('admin', 'team_member'));

-- ── view_stage_states ─────────────────────────────────────────────────────────
CREATE POLICY "view_stage_states: admin all" ON view_stage_states
  FOR ALL USING (current_user_role() = 'admin');

-- Team members can read all view_stage_states (needed for widget conflict detection)
CREATE POLICY "view_stage_states: team read" ON view_stage_states
  FOR SELECT USING (current_user_role() = 'team_member');

-- Team members can update states (start/finish stage)
CREATE POLICY "view_stage_states: team update" ON view_stage_states
  FOR UPDATE USING (current_user_role() = 'team_member');

-- ── stage_events ──────────────────────────────────────────────────────────────
CREATE POLICY "stage_events: admin all" ON stage_events
  FOR ALL USING (current_user_role() = 'admin');

CREATE POLICY "stage_events: team read" ON stage_events
  FOR SELECT USING (current_user_role() = 'team_member');

-- Team members can only insert their own events
CREATE POLICY "stage_events: team insert" ON stage_events
  FOR INSERT WITH CHECK (
    current_user_role() = 'team_member' AND actor_id = auth.uid()
  );

-- ── project_events ────────────────────────────────────────────────────────────
CREATE POLICY "project_events: admin all" ON project_events
  FOR ALL USING (current_user_role() = 'admin');

CREATE POLICY "project_events: team read" ON project_events
  FOR SELECT USING (current_user_role() = 'team_member');
