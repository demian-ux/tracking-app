-- ─────────────────────────────────────────────────────────────────────────────
-- 022 — Per-view-round RPCs
--
-- After migration 018 split delivery_rounds into per-view project_view_rounds,
-- the RPCs from migration 015 became stale (they reference the deleted
-- delivery_rounds table). The application fell back to multi-statement direct
-- writes from lib/actions/stages.ts, which takes 4–5 sequential Supabase
-- round-trips per action.
--
-- This migration adds SECURITY DEFINER RPCs that match the per-view-rounds
-- schema and collapse each hot mutation into a single round-trip.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Drop legacy RPCs that reference the deleted delivery_rounds table ────────
DROP FUNCTION IF EXISTS public.ensure_project_workflow_rpc(uuid);
DROP FUNCTION IF EXISTS public.start_stage_rpc(uuid, uuid, uuid[], public.stage_type, date, public.time_window);
DROP FUNCTION IF EXISTS public.finish_stage_rpc(uuid, uuid, uuid[], public.stage_type);
DROP FUNCTION IF EXISTS public.block_stage_rpc(uuid, uuid, uuid[], public.stage_type, text);
DROP FUNCTION IF EXISTS public.unblock_stage_rpc(uuid, uuid, uuid, public.stage_type);
DROP FUNCTION IF EXISTS public.reopen_stage_rpc(uuid, uuid, uuid, public.stage_type);
DROP FUNCTION IF EXISTS public.mark_delivery_sent_rpc(uuid, uuid);
DROP FUNCTION IF EXISTS public.create_revision_round_rpc(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ensure_workflow_v2_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_workflow_v2_rpc(
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_role    public.user_role;
  v_project RECORD;
  v_stages  public.stage_type[] := ARRAY['initial','advanced','post_production']::public.stage_type[];
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('admin','team_member') THEN
    RAISE EXCEPTION 'You do not have access to this workflow.';
  END IF;

  SELECT id, status INTO v_project FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Project not found.');
  END IF;
  IF v_project.status = 'archived' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Project is archived.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.project_views
    WHERE project_id = p_project_id AND active = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Project has no active views.');
  END IF;

  -- Reactivate the latest round per view when no active round exists
  UPDATE public.project_view_rounds r
     SET status = 'active'
   WHERE r.project_id = p_project_id
     AND r.status <> 'active'
     AND NOT EXISTS (
       SELECT 1 FROM public.project_view_rounds r2
       WHERE r2.project_view_id = r.project_view_id
         AND r2.status = 'active'
     )
     AND r.round_number = (
       SELECT MAX(round_number) FROM public.project_view_rounds r3
       WHERE r3.project_view_id = r.project_view_id
     );

  -- Create round 0 for any active view that still has no rounds
  INSERT INTO public.project_view_rounds (project_id, project_view_id, round_number, status)
  SELECT p_project_id, pv.id, 0, 'active'
  FROM public.project_views pv
  WHERE pv.project_id = p_project_id
    AND pv.active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.project_view_rounds r
      WHERE r.project_view_id = pv.id
    );

  -- Fill missing view_stage_states for every active round
  INSERT INTO public.view_stage_states (project_id, project_view_round_id, project_view_id, stage, status)
  SELECT
    p_project_id,
    r.id,
    r.project_view_id,
    s.stage,
    'not_started'::public.stage_status
  FROM public.project_view_rounds r
  JOIN public.project_views pv ON pv.id = r.project_view_id AND pv.active = true
  CROSS JOIN unnest(v_stages) AS s(stage)
  WHERE r.project_id = p_project_id
    AND r.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.view_stage_states vss
      WHERE vss.project_view_round_id = r.id
        AND vss.project_view_id = r.project_view_id
        AND vss.stage = s.stage
    );

  RETURN jsonb_build_object(
    'ok', true,
    'rounds', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'project_view_id', r.project_view_id,
        'round_number', r.round_number,
        'status', r.status
      )), '[]'::jsonb)
      FROM public.project_view_rounds r
      JOIN public.project_views pv ON pv.id = r.project_view_id AND pv.active = true
      WHERE r.project_id = p_project_id AND r.status = 'active'
    ),
    'states', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'project_view_id', s.project_view_id,
        'project_view_round_id', s.project_view_round_id,
        'stage', s.stage,
        'status', s.status,
        'assigned_user_id', s.assigned_user_id,
        'latest_eta_date', s.latest_eta_date,
        'latest_eta_time_window', s.latest_eta_time_window,
        'block_reason', s.block_reason,
        'status_before_block', s.status_before_block,
        'started_at', s.started_at,
        'completed_at', s.completed_at
      )), '[]'::jsonb)
      FROM public.view_stage_states s
      JOIN public.project_view_rounds r ON r.id = s.project_view_round_id
      JOIN public.project_views pv ON pv.id = r.project_view_id AND pv.active = true
      WHERE r.project_id = p_project_id AND r.status = 'active'
    )
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. start_stage_v2_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_stage_v2_rpc(
  p_project_id      uuid,
  p_view_ids        uuid[],
  p_stage           public.stage_type,
  p_eta_date        date               DEFAULT NULL,
  p_eta_time_window public.time_window DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor          uuid := auth.uid();
  v_role           public.user_role;
  v_clean_view_ids uuid[];
  v_round_count    int;
  v_conflict_ids   uuid[];
  v_not_ready_ids  uuid[];
  v_updated_count  int;
  v_expected_count int;
  v_stage_idx      int;
  v_prev_stage     public.stage_type;
  v_now            timestamptz := now();
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('admin','team_member') THEN
    RAISE EXCEPTION 'You do not have access to this workflow.';
  END IF;

  SELECT array_agg(DISTINCT vid) INTO v_clean_view_ids
  FROM unnest(p_view_ids) AS t(vid) WHERE vid IS NOT NULL;
  IF v_clean_view_ids IS NULL OR array_length(v_clean_view_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Select at least one view.';
  END IF;
  v_expected_count := array_length(v_clean_view_ids, 1);

  SELECT count(*) INTO v_round_count
  FROM public.project_view_rounds
  WHERE project_id = p_project_id
    AND project_view_id = ANY(v_clean_view_ids)
    AND status = 'active';
  IF v_round_count <> v_expected_count THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Could not find active round for all selected views.');
  END IF;

  -- Sequential stage enforcement for team members
  IF v_role <> 'admin' THEN
    v_stage_idx := array_position(ARRAY['initial','advanced','post_production']::public.stage_type[], p_stage);
    IF v_stage_idx > 1 THEN
      v_prev_stage := (ARRAY['initial','advanced','post_production']::public.stage_type[])[v_stage_idx - 1];
      SELECT array_agg(s.project_view_id) INTO v_not_ready_ids
      FROM public.view_stage_states s
      JOIN public.project_view_rounds r ON r.id = s.project_view_round_id
      WHERE r.project_id = p_project_id
        AND r.status = 'active'
        AND s.project_view_id = ANY(v_clean_view_ids)
        AND s.stage = v_prev_stage
        AND s.status <> 'done';
      IF v_not_ready_ids IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Finish the previous stage first.');
      END IF;
    END IF;
  END IF;

  -- Conflict detection
  SELECT array_agg(s.project_view_id) INTO v_conflict_ids
  FROM public.view_stage_states s
  JOIN public.project_view_rounds r ON r.id = s.project_view_round_id
  WHERE r.project_id = p_project_id
    AND r.status = 'active'
    AND s.project_view_id = ANY(v_clean_view_ids)
    AND s.stage = p_stage
    AND s.status = 'in_progress'
    AND s.assigned_user_id IS DISTINCT FROM v_actor;
  IF v_conflict_ids IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'conflict',
      'conflictingViewIds', to_jsonb(v_conflict_ids)
    );
  END IF;

  -- Atomic: update states + log events in one CTE
  WITH updated AS (
    UPDATE public.view_stage_states s
       SET status = 'in_progress',
           assigned_user_id = v_actor,
           started_at = v_now,
           completed_at = NULL,
           latest_eta_date = p_eta_date,
           latest_eta_time_window = p_eta_time_window,
           block_reason = NULL,
           status_before_block = NULL
      FROM public.project_view_rounds r
     WHERE r.id = s.project_view_round_id
       AND r.project_id = p_project_id
       AND r.status = 'active'
       AND s.project_view_id = ANY(v_clean_view_ids)
       AND s.stage = p_stage
       AND s.status IN ('not_started','reopened')
    RETURNING s.id, s.project_view_id, s.project_view_round_id, s.stage,
              s.status, s.assigned_user_id, s.started_at, s.completed_at,
              s.latest_eta_date, s.latest_eta_time_window
  ),
  events_logged AS (
    INSERT INTO public.stage_events (project_id, project_view_round_id, project_view_id, stage, event_type, actor_id, eta_date, eta_time_window)
    SELECT p_project_id, project_view_round_id, project_view_id, p_stage,
           'stage_started'::public.stage_event_type, v_actor, p_eta_date, p_eta_time_window
    FROM updated
    RETURNING 1
  )
  SELECT count(*) INTO v_updated_count FROM updated;

  IF v_updated_count < v_expected_count THEN
    RAISE EXCEPTION 'Some views could not be started in their current state.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'updatedStates', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'project_view_id', s.project_view_id,
        'project_view_round_id', s.project_view_round_id,
        'stage', s.stage,
        'status', s.status,
        'assigned_user_id', s.assigned_user_id,
        'started_at', s.started_at,
        'completed_at', s.completed_at,
        'latest_eta_date', s.latest_eta_date,
        'latest_eta_time_window', s.latest_eta_time_window
      )), '[]'::jsonb)
      FROM public.view_stage_states s
      JOIN public.project_view_rounds r ON r.id = s.project_view_round_id
      WHERE r.project_id = p_project_id
        AND r.status = 'active'
        AND s.project_view_id = ANY(v_clean_view_ids)
        AND s.stage = p_stage
    )
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. finish_stage_v2_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finish_stage_v2_rpc(
  p_project_id uuid,
  p_view_ids   uuid[],
  p_stage      public.stage_type
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor          uuid := auth.uid();
  v_role           public.user_role;
  v_clean_view_ids uuid[];
  v_updated_count  int;
  v_expected_count int;
  v_now            timestamptz := now();
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('admin','team_member') THEN
    RAISE EXCEPTION 'You do not have access to this workflow.';
  END IF;

  SELECT array_agg(DISTINCT vid) INTO v_clean_view_ids
  FROM unnest(p_view_ids) AS t(vid) WHERE vid IS NOT NULL;
  IF v_clean_view_ids IS NULL OR array_length(v_clean_view_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Select at least one view.';
  END IF;
  v_expected_count := array_length(v_clean_view_ids, 1);

  WITH updated AS (
    UPDATE public.view_stage_states s
       SET status = 'done',
           assigned_user_id = NULL,
           completed_at = v_now,
           latest_eta_date = NULL,
           latest_eta_time_window = NULL,
           block_reason = NULL,
           status_before_block = NULL
      FROM public.project_view_rounds r
     WHERE r.id = s.project_view_round_id
       AND r.project_id = p_project_id
       AND r.status = 'active'
       AND s.project_view_id = ANY(v_clean_view_ids)
       AND s.stage = p_stage
       AND s.status = 'in_progress'
       AND (v_role = 'admin' OR s.assigned_user_id = v_actor)
    RETURNING s.id, s.project_view_round_id, s.project_view_id
  ),
  events_logged AS (
    INSERT INTO public.stage_events (project_id, project_view_round_id, project_view_id, stage, event_type, actor_id)
    SELECT p_project_id, project_view_round_id, project_view_id, p_stage,
           'stage_finished'::public.stage_event_type, v_actor
    FROM updated
    RETURNING 1
  )
  SELECT count(*) INTO v_updated_count FROM updated;

  IF v_updated_count < v_expected_count THEN
    RAISE EXCEPTION 'Cannot finish: some views are not in progress or not assigned to you.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'updatedStates', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'project_view_id', s.project_view_id,
        'project_view_round_id', s.project_view_round_id,
        'stage', s.stage,
        'status', s.status,
        'assigned_user_id', s.assigned_user_id,
        'started_at', s.started_at,
        'completed_at', s.completed_at,
        'latest_eta_date', s.latest_eta_date,
        'latest_eta_time_window', s.latest_eta_time_window
      )), '[]'::jsonb)
      FROM public.view_stage_states s
      JOIN public.project_view_rounds r ON r.id = s.project_view_round_id
      WHERE r.project_id = p_project_id
        AND r.status = 'active'
        AND s.project_view_id = ANY(v_clean_view_ids)
        AND s.stage = p_stage
    )
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. block_stage_v2_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.block_stage_v2_rpc(
  p_project_id uuid,
  p_view_ids   uuid[],
  p_stage      public.stage_type,
  p_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor          uuid := auth.uid();
  v_role           public.user_role;
  v_clean_view_ids uuid[];
  v_updated_count  int;
  v_expected_count int;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('admin','team_member') THEN
    RAISE EXCEPTION 'You do not have access to this workflow.';
  END IF;

  SELECT array_agg(DISTINCT vid) INTO v_clean_view_ids
  FROM unnest(p_view_ids) AS t(vid) WHERE vid IS NOT NULL;
  IF v_clean_view_ids IS NULL OR array_length(v_clean_view_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Select at least one view.';
  END IF;
  v_expected_count := array_length(v_clean_view_ids, 1);

  WITH updated AS (
    UPDATE public.view_stage_states s
       SET status = 'blocked',
           block_reason = p_reason,
           status_before_block = 'in_progress'
      FROM public.project_view_rounds r
     WHERE r.id = s.project_view_round_id
       AND r.project_id = p_project_id
       AND r.status = 'active'
       AND s.project_view_id = ANY(v_clean_view_ids)
       AND s.stage = p_stage
       AND s.status = 'in_progress'
       AND (v_role = 'admin' OR s.assigned_user_id = v_actor)
    RETURNING s.id, s.project_view_round_id, s.project_view_id
  ),
  events_logged AS (
    INSERT INTO public.stage_events (project_id, project_view_round_id, project_view_id, stage, event_type, actor_id)
    SELECT p_project_id, project_view_round_id, project_view_id, p_stage,
           'stage_blocked'::public.stage_event_type, v_actor
    FROM updated
    RETURNING 1
  )
  SELECT count(*) INTO v_updated_count FROM updated;

  IF v_updated_count < v_expected_count THEN
    RAISE EXCEPTION 'Cannot block: some views are not in progress or not assigned to you.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'updatedStates', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'project_view_id', s.project_view_id,
        'project_view_round_id', s.project_view_round_id,
        'stage', s.stage,
        'status', s.status,
        'assigned_user_id', s.assigned_user_id,
        'started_at', s.started_at,
        'completed_at', s.completed_at,
        'latest_eta_date', s.latest_eta_date,
        'latest_eta_time_window', s.latest_eta_time_window,
        'block_reason', s.block_reason
      )), '[]'::jsonb)
      FROM public.view_stage_states s
      JOIN public.project_view_rounds r ON r.id = s.project_view_round_id
      WHERE r.project_id = p_project_id
        AND r.status = 'active'
        AND s.project_view_id = ANY(v_clean_view_ids)
        AND s.stage = p_stage
    )
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. reset_stage_v2_rpc — cascade reset from chosen stage forward
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reset_stage_v2_rpc(
  p_project_id uuid,
  p_view_ids   uuid[],
  p_stage      public.stage_type
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor              uuid := auth.uid();
  v_role               public.user_role;
  v_clean_view_ids     uuid[];
  v_stage_idx          int;
  v_stages_to_reset    public.stage_type[];
  v_unauthorized_count int;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('admin','team_member') THEN
    RAISE EXCEPTION 'You do not have access to this workflow.';
  END IF;

  SELECT array_agg(DISTINCT vid) INTO v_clean_view_ids
  FROM unnest(p_view_ids) AS t(vid) WHERE vid IS NOT NULL;
  IF v_clean_view_ids IS NULL OR array_length(v_clean_view_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Select at least one view.';
  END IF;

  v_stage_idx := array_position(ARRAY['initial','advanced','post_production']::public.stage_type[], p_stage);
  v_stages_to_reset := (ARRAY['initial','advanced','post_production']::public.stage_type[])[v_stage_idx:3];

  IF v_role <> 'admin' THEN
    SELECT count(*) INTO v_unauthorized_count
    FROM public.view_stage_states s
    JOIN public.project_view_rounds r ON r.id = s.project_view_round_id
    WHERE r.project_id = p_project_id
      AND r.status = 'active'
      AND s.project_view_id = ANY(v_clean_view_ids)
      AND s.stage = p_stage
      AND s.status <> 'not_started'
      AND s.assigned_user_id IS DISTINCT FROM v_actor;
    IF v_unauthorized_count > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'You can only reset stages assigned to you.');
    END IF;
  END IF;

  WITH updated AS (
    UPDATE public.view_stage_states s
       SET status = 'not_started',
           assigned_user_id = NULL,
           started_at = NULL,
           completed_at = NULL,
           latest_eta_date = NULL,
           latest_eta_time_window = NULL,
           block_reason = NULL,
           status_before_block = NULL
      FROM public.project_view_rounds r
     WHERE r.id = s.project_view_round_id
       AND r.project_id = p_project_id
       AND r.status = 'active'
       AND s.project_view_id = ANY(v_clean_view_ids)
       AND s.stage = ANY(v_stages_to_reset)
       AND s.status <> 'not_started'
    RETURNING s.id, s.project_view_round_id, s.project_view_id, s.stage
  ),
  events_logged AS (
    INSERT INTO public.stage_events (project_id, project_view_round_id, project_view_id, stage, event_type, actor_id)
    SELECT p_project_id, project_view_round_id, project_view_id, stage,
           'stage_reset'::public.stage_event_type, v_actor
    FROM updated
    RETURNING 1
  )
  SELECT count(*) INTO v_unauthorized_count FROM updated;

  RETURN jsonb_build_object(
    'ok', true,
    'updatedStates', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'project_view_id', s.project_view_id,
        'project_view_round_id', s.project_view_round_id,
        'stage', s.stage,
        'status', s.status,
        'assigned_user_id', s.assigned_user_id,
        'started_at', s.started_at,
        'completed_at', s.completed_at,
        'latest_eta_date', s.latest_eta_date,
        'latest_eta_time_window', s.latest_eta_time_window,
        'block_reason', s.block_reason
      )), '[]'::jsonb)
      FROM public.view_stage_states s
      JOIN public.project_view_rounds r ON r.id = s.project_view_round_id
      WHERE r.project_id = p_project_id
        AND r.status = 'active'
        AND s.project_view_id = ANY(v_clean_view_ids)
        AND s.stage = ANY(v_stages_to_reset)
    )
  );
END;
$$;

-- ── Permissions ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.ensure_workflow_v2_rpc(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_stage_v2_rpc(uuid, uuid[], public.stage_type, date, public.time_window) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_stage_v2_rpc(uuid, uuid[], public.stage_type) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_stage_v2_rpc(uuid, uuid[], public.stage_type, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_stage_v2_rpc(uuid, uuid[], public.stage_type) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_workflow_v2_rpc(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_stage_v2_rpc(uuid, uuid[], public.stage_type, date, public.time_window) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_stage_v2_rpc(uuid, uuid[], public.stage_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_stage_v2_rpc(uuid, uuid[], public.stage_type, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_stage_v2_rpc(uuid, uuid[], public.stage_type) TO authenticated;
