-- Drop delivery_round_id from view_stage_states and stage_events (drops FK automatically)
ALTER TABLE view_stage_states DROP COLUMN IF EXISTS delivery_round_id;
ALTER TABLE stage_events DROP COLUMN IF EXISTS delivery_round_id;

-- Drop delivery_rounds table
DROP TABLE IF EXISTS delivery_rounds;

-- Add current_round_number to project_views
ALTER TABLE project_views ADD COLUMN IF NOT EXISTS current_round_number INT NOT NULL DEFAULT 0;

-- Create project_view_rounds
CREATE TABLE project_view_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_view_id UUID NOT NULL REFERENCES project_views(id) ON DELETE CASCADE,
  round_number INT NOT NULL DEFAULT 0,
  status round_status NOT NULL DEFAULT 'active',
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_view_id, round_number)
);

-- Add project_view_round_id to view_stage_states
ALTER TABLE view_stage_states ADD COLUMN IF NOT EXISTS project_view_round_id UUID REFERENCES project_view_rounds(id) ON DELETE CASCADE;

-- Add project_view_round_id to stage_events
ALTER TABLE stage_events ADD COLUMN IF NOT EXISTS project_view_round_id UUID REFERENCES project_view_rounds(id) ON DELETE CASCADE;

-- Delete orphaned rows (existing data that has no view round)
DELETE FROM stage_events WHERE project_view_round_id IS NULL;
DELETE FROM view_stage_states WHERE project_view_round_id IS NULL;

-- Make NOT NULL
ALTER TABLE view_stage_states ALTER COLUMN project_view_round_id SET NOT NULL;
ALTER TABLE stage_events ALTER COLUMN project_view_round_id SET NOT NULL;

-- RLS
ALTER TABLE project_view_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_view_rounds: admin all" ON project_view_rounds
  FOR ALL USING (current_user_role() = 'admin');

CREATE POLICY "project_view_rounds: team read" ON project_view_rounds
  FOR SELECT USING (current_user_role() IN ('admin', 'team_member'));

CREATE POLICY "project_view_rounds: team insert" ON project_view_rounds
  FOR INSERT WITH CHECK (current_user_role() IN ('admin', 'team_member'));

CREATE POLICY "project_view_rounds: team update" ON project_view_rounds
  FOR UPDATE USING (current_user_role() IN ('admin', 'team_member'));
