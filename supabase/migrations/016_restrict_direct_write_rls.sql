-- ============================================================
-- 016 - Restrict direct-write RLS now that all mutations go
--       through SECURITY DEFINER RPC functions (015).
-- ============================================================
-- Team members no longer need direct UPDATE on view_stage_states
-- or direct INSERT on delivery_rounds / view_stage_states.
-- All those writes are handled atomically inside the RPCs.

DROP POLICY IF EXISTS "view_stage_states: team update"       ON view_stage_states;
DROP POLICY IF EXISTS "delivery_rounds: team insert repair"  ON delivery_rounds;
DROP POLICY IF EXISTS "view_stage_states: team insert repair" ON view_stage_states;
