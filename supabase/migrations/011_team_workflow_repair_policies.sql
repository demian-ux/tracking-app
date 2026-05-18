-- ============================================================
-- 011 - Allow widget workflow repair inserts
-- ============================================================
-- Team members can update existing stage rows, but older/broken projects may be
-- missing the active round or stage-state rows. The widget repair action needs
-- insert permission to restore that workflow shape.

CREATE POLICY "delivery_rounds: team insert repair" ON delivery_rounds
  FOR INSERT WITH CHECK (current_user_role() IN ('admin', 'team_member'));

CREATE POLICY "view_stage_states: team insert repair" ON view_stage_states
  FOR INSERT WITH CHECK (current_user_role() IN ('admin', 'team_member'));
