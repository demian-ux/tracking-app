-- ─────────────────────────────────────────────────────────────────────────────
-- 024 — Transactional delivery RPCs + security hardening
--
-- 1. mark_delivery_sent_v2_rpc / undo_delivery_sent_v2_rpc /
--    create_revision_round_v2_rpc: the three delivery operations were
--    multi-statement direct writes in lib/actions/delivery.ts with no
--    transaction boundary (a stage could be started between the all-done check
--    and the delivered write; undo could race with revision-round creation).
--    Each is now a single SECURITY DEFINER function, so the whole operation
--    commits or rolls back as one unit. Rows are locked FOR UPDATE where a
--    check-then-write gap existed.
-- 2. ensure_workflow_v2_rpc no longer reactivates *delivered* rounds: after a
--    delivery, a view stays locked until the admin creates a revision round or
--    undoes the delivery. Legacy non-delivered statuses are still repaired.
-- 3. Repairs the REVOKE/GRANT from migration 015 that targeted a non-existent
--    6-parameter signature of create_project_workflow_rpc.
-- 4. Drops the team INSERT/UPDATE policies on project_view_rounds: all round
--    mutations go through SECURITY DEFINER RPCs or admin policies, so team
--    members no longer need (and should not have) direct write access.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1a. mark_delivery_sent_v2_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_delivery_sent_v2_rpc(
  p_project_id uuid,
  p_view_ids   uuid[]
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
  v_round_ids      uuid[];
  v_incomplete     jsonb;
  v_now            timestamptz := now();
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can mark deliveries as sent.';
  END IF;

  SELECT array_agg(DISTINCT vid) INTO v_clean_view_ids
  FROM unnest(p_view_ids) AS t(vid) WHERE vid IS NOT NULL;
  IF v_clean_view_ids IS NULL OR array_length(v_clean_view_ids, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No views selected');
  END IF;

  -- Lock the active rounds so no stage can be started/finished concurrently
  -- between the all-done check and the delivered write.
  SELECT array_agg(r.id) INTO v_round_ids
  FROM public.project_view_rounds r
  WHERE r.project_id = p_project_id
    AND r.status = 'active'
    AND r.project_view_id = ANY(v_clean_view_ids)
  FOR UPDATE OF r;

  IF v_round_ids IS NULL OR array_length(v_round_ids, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No active rounds found for selected views');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'viewLabel', pv.label,
    'stage', s.stage,
    'status', s.status
  )) INTO v_incomplete
  FROM public.view_stage_states s
  JOIN public.project_views pv ON pv.id = s.project_view_id
  WHERE s.project_view_round_id = ANY(v_round_ids)
    AND s.status <> 'done';

  IF v_incomplete IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'incomplete',
      'incomplete', v_incomplete
    );
  END IF;

  UPDATE public.project_view_rounds
     SET status = 'delivered',
         delivered_at = v_now
   WHERE id = ANY(v_round_ids);

  UPDATE public.projects
     SET status = 'waiting_for_feedback',
         delivery_count = delivery_count + 1
   WHERE id = p_project_id;

  INSERT INTO public.project_events (project_id, actor_id, event_type, payload)
  VALUES (
    p_project_id, v_actor, 'delivery_marked_sent',
    jsonb_build_object('view_ids', to_jsonb(v_clean_view_ids), 'delivered_at', v_now)
  );

  RETURN jsonb_build_object('ok', true, 'deliveredAt', v_now, 'roundCount', array_length(v_round_ids, 1));
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b. undo_delivery_sent_v2_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.undo_delivery_sent_v2_rpc(
  p_project_id   uuid,
  p_delivered_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor         uuid := auth.uid();
  v_role          public.user_role;
  v_reverted      int;
  v_removed       int := 0;
  v_dirty_later   int;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can undo a delivery.';
  END IF;

  -- Lock the delivered rounds belonging to this delivery, plus all later
  -- rounds of the same views, so revision-round creation can't race the undo.
  CREATE TEMP TABLE _undo_rounds ON COMMIT DROP AS
  SELECT r.id, r.project_view_id, r.round_number
  FROM public.project_view_rounds r
  WHERE r.project_id = p_project_id
    AND r.status = 'delivered'
    AND r.delivered_at = p_delivered_at
  FOR UPDATE OF r;

  IF NOT EXISTS (SELECT 1 FROM _undo_rounds) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No delivery found at that timestamp.');
  END IF;

  CREATE TEMP TABLE _later_rounds ON COMMIT DROP AS
  SELECT lr.id
  FROM public.project_view_rounds lr
  JOIN _undo_rounds u ON u.project_view_id = lr.project_view_id
  WHERE lr.project_id = p_project_id
    AND lr.round_number > u.round_number
  FOR UPDATE OF lr;

  -- Refuse if any later (revision) round has started work.
  SELECT count(*) INTO v_dirty_later
  FROM public.view_stage_states s
  WHERE s.project_view_round_id IN (SELECT id FROM _later_rounds)
    AND s.status <> 'not_started';

  IF v_dirty_later > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Cannot undo: a revision round after this delivery has started work. Reset those stages back to "not started" first, then try again.'
    );
  END IF;

  DELETE FROM public.project_view_rounds
  WHERE id IN (SELECT id FROM _later_rounds);
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Keep project_views.current_round_number consistent with the surviving rounds.
  UPDATE public.project_views pv
     SET current_round_number = u.round_number
    FROM _undo_rounds u
   WHERE pv.id = u.project_view_id
     AND pv.current_round_number > u.round_number;

  UPDATE public.project_view_rounds
     SET status = 'active',
         delivered_at = NULL
   WHERE id IN (SELECT id FROM _undo_rounds);
  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  UPDATE public.projects
     SET status = 'active',
         delivery_count = GREATEST(0, delivery_count - 1)
   WHERE id = p_project_id;

  INSERT INTO public.project_events (project_id, actor_id, event_type, payload)
  VALUES (
    p_project_id, v_actor, 'delivery_undone',
    jsonb_build_object(
      'delivered_at', p_delivered_at,
      'view_ids', (SELECT to_jsonb(array_agg(project_view_id)) FROM _undo_rounds),
      'revision_rounds_removed', v_removed
    )
  );

  RETURN jsonb_build_object('ok', true, 'revertedCount', v_reverted, 'revisionRoundsRemoved', v_removed);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1c. create_revision_round_v2_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_revision_round_v2_rpc(
  p_project_id uuid,
  p_view_ids   uuid[]
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
  v_status         public.project_status;
  v_stages         public.stage_type[] := ARRAY['initial','advanced','post_production']::public.stage_type[];
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can create revision rounds.';
  END IF;

  SELECT array_agg(DISTINCT vid) INTO v_clean_view_ids
  FROM unnest(p_view_ids) AS t(vid) WHERE vid IS NOT NULL;
  IF v_clean_view_ids IS NULL OR array_length(v_clean_view_ids, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No views selected');
  END IF;

  SELECT status INTO v_status FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Project not found');
  END IF;
  IF v_status NOT IN ('waiting_for_feedback', 'delivered') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Project is not waiting for feedback or delivered');
  END IF;

  -- Refuse for views that still have an active round (nothing to revise yet);
  -- the UNIQUE(project_view_id, round_number) constraint also guards against
  -- a concurrent duplicate, but this gives a clean error instead.
  IF EXISTS (
    SELECT 1 FROM public.project_view_rounds r
    WHERE r.project_id = p_project_id
      AND r.project_view_id = ANY(v_clean_view_ids)
      AND r.status = 'active'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Some selected views already have an active round.');
  END IF;

  WITH next_numbers AS (
    SELECT v.vid AS project_view_id,
           COALESCE((
             SELECT MAX(r.round_number) + 1
             FROM public.project_view_rounds r
             WHERE r.project_view_id = v.vid
           ), 1) AS round_number
    FROM unnest(v_clean_view_ids) AS v(vid)
  ),
  new_rounds AS (
    INSERT INTO public.project_view_rounds (project_id, project_view_id, round_number, status)
    SELECT p_project_id, project_view_id, round_number, 'active'
    FROM next_numbers
    RETURNING id, project_view_id, round_number
  ),
  new_states AS (
    INSERT INTO public.view_stage_states (project_id, project_view_round_id, project_view_id, stage, status)
    SELECT p_project_id, nr.id, nr.project_view_id, s.stage, 'not_started'::public.stage_status
    FROM new_rounds nr
    CROSS JOIN unnest(v_stages) AS s(stage)
    RETURNING 1
  )
  UPDATE public.project_views pv
     SET current_round_number = nr.round_number
    FROM new_rounds nr
   WHERE pv.id = nr.project_view_id;

  UPDATE public.projects SET status = 'revision' WHERE id = p_project_id;

  INSERT INTO public.project_events (project_id, actor_id, event_type, payload)
  VALUES (
    p_project_id, v_actor, 'revision_round_created',
    jsonb_build_object('view_ids', to_jsonb(v_clean_view_ids))
  );

  RETURN jsonb_build_object('ok', true, 'viewIds', to_jsonb(v_clean_view_ids));
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ensure_workflow_v2_rpc — stop reactivating delivered rounds
-- ─────────────────────────────────────────────────────────────────────────────
-- Identical to the 022 version except the reactivation block now excludes
-- rounds with status 'delivered': after a delivery, the view stays locked
-- until a revision round is created or the delivery is undone. Legacy
-- statuses (e.g. revision_requested) are still repaired to 'active'.
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

  -- Repair-reactivate the latest round per view when no active round exists,
  -- but never a delivered round: delivered views stay locked until a revision
  -- round is created or the delivery is undone.
  UPDATE public.project_view_rounds r
     SET status = 'active'
   WHERE r.project_id = p_project_id
     AND r.status NOT IN ('active', 'delivered')
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
-- 3. Repair migration 015's REVOKE/GRANT on create_project_workflow_rpc
-- ─────────────────────────────────────────────────────────────────────────────
-- 015 targeted a (text,uuid,date,time_window,int,text) signature that never
-- existed, so the statements failed against the real 5-parameter function and
-- it may still carry default EXECUTE for PUBLIC. Re-apply with the correct
-- signature, guarded in case the function was already dropped.
DO $$
BEGIN
  IF to_regprocedure('public.create_project_workflow_rpc(text,uuid,date,public.time_window,int)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.create_project_workflow_rpc(text,uuid,date,public.time_window,int) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.create_project_workflow_rpc(text,uuid,date,public.time_window,int) FROM anon;
    GRANT EXECUTE ON FUNCTION public.create_project_workflow_rpc(text,uuid,date,public.time_window,int) TO authenticated;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Tighten RLS: team members no longer write project_view_rounds directly
-- ─────────────────────────────────────────────────────────────────────────────
-- All round mutations now happen via SECURITY DEFINER RPCs (which bypass RLS)
-- or under the admin ALL policy. The open team INSERT/UPDATE policies from 018
-- let any team member e.g. mark a round 'delivered' with a direct PostgREST
-- call, bypassing every workflow check.
DROP POLICY IF EXISTS "project_view_rounds: team insert" ON public.project_view_rounds;
DROP POLICY IF EXISTS "project_view_rounds: team update" ON public.project_view_rounds;

-- ── Permissions for the new RPCs ─────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.mark_delivery_sent_v2_rpc(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_delivery_sent_v2_rpc(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_revision_round_v2_rpc(uuid, uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mark_delivery_sent_v2_rpc(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_delivery_sent_v2_rpc(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_revision_round_v2_rpc(uuid, uuid[]) TO authenticated;
