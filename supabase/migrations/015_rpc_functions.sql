-- ─────────────────────────────────────────────────────────────────────────────
-- All critical multi-step write operations as SECURITY DEFINER Postgres RPCs.
-- Each function validates the caller's role via auth.uid(), performs all writes
-- in one implicit transaction, and returns JSONB.
--
-- Return convention:
--   success  → { "ok": true, ...extra fields }
--   expected validation failure → { "ok": false, "error": "message", ...extra }
--   unexpected / auth failure   → RAISE EXCEPTION (becomes a Supabase error)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Helper: get caller role ───────────────────────────────────────────────────
-- (current_user_role() already exists from 002_rls.sql but we reference it inline
--  inside each function to avoid cross-function dependencies)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ensure_project_workflow_rpc
--    Find or create the active delivery round for a project and fill any missing
--    view_stage_states rows. Returns the round and full states array.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_project_workflow_rpc(
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor     uuid  := auth.uid();
  v_role      public.user_role;
  v_project   RECORD;
  v_round     RECORD;
  v_view      RECORD;
  v_state_key text;
  v_existing_keys text[];
  v_missing_stages public.stage_type[];
  v_stages    public.stage_type[] := ARRAY['initial','advanced','post_production']::public.stage_type[];
BEGIN
  -- Auth
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('admin','team_member') THEN
    RAISE EXCEPTION 'You do not have access to this workflow.';
  END IF;

  -- Project
  SELECT id, status, current_round_number
    INTO v_project
    FROM public.projects
   WHERE id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;

  IF v_project.status = 'archived' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This project is archived.');
  END IF;

  IF v_project.status IN ('waiting_for_feedback','delivered') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No active work for this project right now.');
  END IF;

  -- Active views must exist
  IF NOT EXISTS (
    SELECT 1 FROM public.project_views
    WHERE project_id = p_project_id AND active = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This project has no active views.');
  END IF;

  -- Find working round (by current_round_number first, then any working round)
  SELECT * INTO v_round
    FROM public.delivery_rounds
   WHERE project_id = p_project_id
     AND round_number = v_project.current_round_number;

  IF NOT FOUND THEN
    -- Fall back to latest working round
    SELECT * INTO v_round
      FROM public.delivery_rounds
     WHERE project_id = p_project_id
       AND status IN ('active','ready_for_admin_review')
     ORDER BY round_number DESC
     LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    -- Create a new round
    INSERT INTO public.delivery_rounds (project_id, round_number, status)
    VALUES (p_project_id, COALESCE(v_project.current_round_number, 0), 'active')
    RETURNING * INTO v_round;
  ELSIF v_round.status NOT IN ('active','ready_for_admin_review') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No active delivery round. Ask an admin to create a new round.');
  END IF;

  -- Upsert missing view_stage_states
  INSERT INTO public.view_stage_states (project_id, delivery_round_id, project_view_id, stage, status)
  SELECT p_project_id, v_round.id, pv.id, s.stage, 'not_started'
  FROM public.project_views pv
  CROSS JOIN unnest(v_stages) AS s(stage)
  WHERE pv.project_id = p_project_id
    AND pv.active = true
  ON CONFLICT (delivery_round_id, project_view_id, stage) DO NOTHING;

  -- Return round + all states
  RETURN jsonb_build_object(
    'ok', true,
    'round', jsonb_build_object(
      'id',           v_round.id,
      'project_id',   v_round.project_id,
      'round_number', v_round.round_number,
      'status',       v_round.status
    ),
    'states', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id',                    s.id,
          'project_view_id',       s.project_view_id,
          'delivery_round_id',     s.delivery_round_id,
          'stage',                 s.stage,
          'status',                s.status,
          'assigned_user_id',      s.assigned_user_id,
          'latest_eta_date',       s.latest_eta_date,
          'latest_eta_time_window',s.latest_eta_time_window,
          'block_reason',          s.block_reason,
          'status_before_block',   s.status_before_block,
          'started_at',            s.started_at,
          'completed_at',          s.completed_at,
          'updated_at',            s.updated_at
        )
      ), '[]'::jsonb)
      FROM public.view_stage_states s
      WHERE s.delivery_round_id = v_round.id
    )
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. start_stage_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_stage_rpc(
  p_project_id       uuid,
  p_round_id         uuid,
  p_view_ids         uuid[],
  p_stage            public.stage_type,
  p_eta_date         date         DEFAULT NULL,
  p_eta_time_window  public.time_window DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor          uuid  := auth.uid();
  v_role           public.user_role;
  v_clean_view_ids uuid[];
  v_conflict_ids   uuid[];
  v_updated_count  int;
  v_now            timestamptz := now();
BEGIN
  -- Auth
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('admin','team_member') THEN
    RAISE EXCEPTION 'You do not have access to this workflow.';
  END IF;

  -- Deduplicate view IDs
  SELECT array_agg(DISTINCT vid) INTO v_clean_view_ids FROM unnest(p_view_ids) AS t(vid) WHERE vid IS NOT NULL;
  IF v_clean_view_ids IS NULL OR array_length(v_clean_view_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Select at least one view.';
  END IF;

  -- Validate round belongs to project
  IF NOT EXISTS (
    SELECT 1 FROM public.delivery_rounds
    WHERE id = p_round_id AND project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'This round does not belong to the project.';
  END IF;

  -- Validate views belong to project and are active
  IF (
    SELECT count(*) FROM public.project_views
    WHERE id = ANY(v_clean_view_ids) AND project_id = p_project_id AND active = true
  ) <> array_length(v_clean_view_ids, 1) THEN
    RAISE EXCEPTION 'One or more selected views are not valid for this project.';
  END IF;

  -- Detect conflicts: in_progress by someone else
  SELECT array_agg(project_view_id)
    INTO v_conflict_ids
    FROM public.view_stage_states
   WHERE project_id        = p_project_id
     AND delivery_round_id = p_round_id
     AND project_view_id   = ANY(v_clean_view_ids)
     AND stage             = p_stage
     AND status            = 'in_progress'
     AND assigned_user_id IS DISTINCT FROM v_actor;

  IF v_conflict_ids IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'conflict',
      'conflicting_view_ids', to_jsonb(v_conflict_ids)
    );
  END IF;

  -- Update eligible rows
  UPDATE public.view_stage_states
     SET status             = 'in_progress',
         assigned_user_id   = v_actor,
         started_at         = v_now,
         completed_at       = NULL,
         latest_eta_date    = p_eta_date,
         latest_eta_time_window = p_eta_time_window,
         block_reason       = NULL,
         status_before_block = NULL
   WHERE project_id        = p_project_id
     AND delivery_round_id = p_round_id
     AND project_view_id   = ANY(v_clean_view_ids)
     AND stage             = p_stage
     AND status            IN ('not_started','reopened');

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count < array_length(v_clean_view_ids, 1) THEN
    -- Find blocking reason
    IF EXISTS (
      SELECT 1 FROM public.view_stage_states
      WHERE project_id = p_project_id AND delivery_round_id = p_round_id
        AND project_view_id = ANY(v_clean_view_ids) AND stage = p_stage AND status = 'done'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Some views are already done.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.view_stage_states
      WHERE project_id = p_project_id AND delivery_round_id = p_round_id
        AND project_view_id = ANY(v_clean_view_ids) AND stage = p_stage AND status = 'blocked'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Some views are blocked. Ask an admin to unblock them.');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'Could not start one or more selected views.');
  END IF;

  -- Log events
  INSERT INTO public.stage_events (project_id, delivery_round_id, project_view_id, stage, event_type, actor_id, eta_date, eta_time_window)
  SELECT p_project_id, p_round_id, vid, p_stage, 'stage_started', v_actor, p_eta_date, p_eta_time_window
  FROM unnest(v_clean_view_ids) AS t(vid);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. finish_stage_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finish_stage_rpc(
  p_project_id       uuid,
  p_round_id         uuid,
  p_view_ids         uuid[],
  p_stage            public.stage_type
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor          uuid  := auth.uid();
  v_role           public.user_role;
  v_clean_view_ids uuid[];
  v_updated_count  int;
  v_now            timestamptz := now();
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('admin','team_member') THEN
    RAISE EXCEPTION 'You do not have access to this workflow.';
  END IF;

  SELECT array_agg(DISTINCT vid) INTO v_clean_view_ids FROM unnest(p_view_ids) AS t(vid) WHERE vid IS NOT NULL;
  IF v_clean_view_ids IS NULL OR array_length(v_clean_view_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Select at least one view.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.delivery_rounds WHERE id = p_round_id AND project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'This round does not belong to the project.';
  END IF;

  UPDATE public.view_stage_states
     SET status             = 'done',
         completed_at       = v_now,
         block_reason       = NULL,
         status_before_block = NULL
   WHERE project_id        = p_project_id
     AND delivery_round_id = p_round_id
     AND project_view_id   = ANY(v_clean_view_ids)
     AND stage             = p_stage
     AND status            = 'in_progress'
     AND (v_role = 'admin' OR assigned_user_id = v_actor);

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count < array_length(v_clean_view_ids, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Could not finish — some views are not in progress or belong to another user.');
  END IF;

  INSERT INTO public.stage_events (project_id, delivery_round_id, project_view_id, stage, event_type, actor_id)
  SELECT p_project_id, p_round_id, vid, p_stage, 'stage_finished', v_actor
  FROM unnest(v_clean_view_ids) AS t(vid);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. block_stage_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.block_stage_rpc(
  p_project_id       uuid,
  p_round_id         uuid,
  p_view_ids         uuid[],
  p_stage            public.stage_type,
  p_reason           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor          uuid  := auth.uid();
  v_role           public.user_role;
  v_clean_view_ids uuid[];
  v_updated_count  int;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('admin','team_member') THEN
    RAISE EXCEPTION 'You do not have access to this workflow.';
  END IF;

  SELECT array_agg(DISTINCT vid) INTO v_clean_view_ids FROM unnest(p_view_ids) AS t(vid) WHERE vid IS NOT NULL;
  IF v_clean_view_ids IS NULL OR array_length(v_clean_view_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Select at least one view.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.delivery_rounds WHERE id = p_round_id AND project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'This round does not belong to the project.';
  END IF;

  UPDATE public.view_stage_states
     SET status              = 'blocked',
         block_reason        = p_reason,
         status_before_block = 'in_progress'
   WHERE project_id        = p_project_id
     AND delivery_round_id = p_round_id
     AND project_view_id   = ANY(v_clean_view_ids)
     AND stage             = p_stage
     AND status            = 'in_progress'
     AND (v_role = 'admin' OR assigned_user_id = v_actor);

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only in-progress stages you own can be blocked.');
  END IF;

  INSERT INTO public.stage_events (project_id, delivery_round_id, project_view_id, stage, event_type, actor_id)
  SELECT p_project_id, p_round_id, vid, p_stage, 'stage_blocked', v_actor
  FROM unnest(v_clean_view_ids) AS t(vid);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. unblock_stage_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unblock_stage_rpc(
  p_project_id  uuid,
  p_round_id    uuid,
  p_view_id     uuid,
  p_stage       public.stage_type
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor         uuid  := auth.uid();
  v_role          public.user_role;
  v_state         RECORD;
  v_restore       public.stage_status;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can unblock stages.';
  END IF;

  SELECT status, status_before_block, started_at
    INTO v_state
    FROM public.view_stage_states
   WHERE project_id        = p_project_id
     AND delivery_round_id = p_round_id
     AND project_view_id   = p_view_id
     AND stage             = p_stage;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage state not found.';
  END IF;

  IF v_state.status <> 'blocked' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Stage is not blocked.');
  END IF;

  v_restore := COALESCE(
    v_state.status_before_block,
    CASE WHEN v_state.started_at IS NOT NULL THEN 'in_progress'::public.stage_status
         ELSE 'not_started'::public.stage_status
    END
  );

  UPDATE public.view_stage_states
     SET status              = v_restore,
         block_reason        = NULL,
         status_before_block = NULL
   WHERE project_id        = p_project_id
     AND delivery_round_id = p_round_id
     AND project_view_id   = p_view_id
     AND stage             = p_stage;

  INSERT INTO public.stage_events (project_id, delivery_round_id, project_view_id, stage, event_type, actor_id)
  VALUES (p_project_id, p_round_id, p_view_id, p_stage, 'stage_unblocked', v_actor);

  RETURN jsonb_build_object('ok', true, 'restored_status', v_restore);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. reopen_stage_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reopen_stage_rpc(
  p_project_id  uuid,
  p_round_id    uuid,
  p_view_id     uuid,
  p_stage       public.stage_type
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_role   public.user_role;
  v_count  int;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can reopen stages.';
  END IF;

  UPDATE public.view_stage_states
     SET status              = 'reopened',
         assigned_user_id    = NULL,
         started_at          = NULL,
         completed_at        = NULL,
         latest_eta_date     = NULL,
         latest_eta_time_window = NULL,
         block_reason        = NULL,
         status_before_block = NULL
   WHERE project_id        = p_project_id
     AND delivery_round_id = p_round_id
     AND project_view_id   = p_view_id
     AND stage             = p_stage
     AND status            = 'done';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Stage is not done and cannot be reopened.');
  END IF;

  INSERT INTO public.stage_events (project_id, delivery_round_id, project_view_id, stage, event_type, actor_id)
  VALUES (p_project_id, p_round_id, p_view_id, p_stage, 'stage_reopened', v_actor);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. create_project_workflow_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_project_workflow_rpc(
  p_name                   text,
  p_client_id              uuid         DEFAULT NULL,
  p_delivery_date          date         DEFAULT NULL,
  p_delivery_time_window   public.time_window DEFAULT NULL,
  p_view_count             int          DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_role       public.user_role;
  v_project_id uuid;
  v_round_id   uuid;
  v_view_id    uuid;
  v_view_ids   uuid[] := '{}';
  i            int;
  v_stages     public.stage_type[] := ARRAY['initial','advanced','post_production']::public.stage_type[];
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can create projects.';
  END IF;

  IF p_view_count < 1 THEN
    RAISE EXCEPTION 'view_count must be at least 1.';
  END IF;

  -- Insert project
  INSERT INTO public.projects (name, client_id, delivery_date, delivery_time_window, view_count, status)
  VALUES (p_name, p_client_id, p_delivery_date, p_delivery_time_window, p_view_count, 'active')
  RETURNING id INTO v_project_id;

  -- Insert views
  FOR i IN 1..p_view_count LOOP
    INSERT INTO public.project_views (project_id, number, label)
    VALUES (v_project_id, i, 'View ' || lpad(i::text, 2, '0'))
    RETURNING id INTO v_view_id;
    v_view_ids := v_view_ids || v_view_id;
  END LOOP;

  -- Insert Round 00
  INSERT INTO public.delivery_rounds (project_id, round_number, status)
  VALUES (v_project_id, 0, 'active')
  RETURNING id INTO v_round_id;

  -- Insert view_stage_states: all views × all stages
  INSERT INTO public.view_stage_states (project_id, delivery_round_id, project_view_id, stage, status)
  SELECT v_project_id, v_round_id, vid, s.stage, 'not_started'
  FROM unnest(v_view_ids) AS t(vid)
  CROSS JOIN unnest(v_stages) AS s(stage);

  -- Log event
  INSERT INTO public.project_events (project_id, actor_id, event_type, payload)
  VALUES (v_project_id, v_actor, 'project_created',
    jsonb_build_object('name', p_name, 'view_count', p_view_count));

  RETURN jsonb_build_object('ok', true, 'project_id', v_project_id, 'round_id', v_round_id);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. mark_delivery_sent_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_delivery_sent_rpc(
  p_project_id  uuid,
  p_round_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor         uuid := auth.uid();
  v_role          public.user_role;
  v_delivery_count int;
  v_incomplete    jsonb;
  v_now           timestamptz := now();
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can mark delivery sent.';
  END IF;

  -- Validate round belongs to project
  IF NOT EXISTS (
    SELECT 1 FROM public.delivery_rounds WHERE id = p_round_id AND project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'Round does not belong to project.';
  END IF;

  -- Check all active views × all stages are done
  SELECT jsonb_agg(
    jsonb_build_object(
      'view_label',  pv.label,
      'stage_label', vss.stage::text,
      'status',      vss.status::text
    )
  )
  INTO v_incomplete
  FROM public.project_views pv
  CROSS JOIN unnest(ARRAY['initial','advanced','post_production']::public.stage_type[]) AS t(stage)
  LEFT JOIN public.view_stage_states vss
    ON vss.project_view_id   = pv.id
   AND vss.delivery_round_id = p_round_id
   AND vss.stage             = t.stage
  WHERE pv.project_id = p_project_id
    AND pv.active     = true
    AND (vss.id IS NULL OR vss.status <> 'done');

  IF v_incomplete IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Delivery is not ready. ' || jsonb_array_length(v_incomplete)::text || ' stage(s) incomplete.',
      'incomplete', v_incomplete
    );
  END IF;

  -- Mark round delivered
  UPDATE public.delivery_rounds
     SET status       = 'delivered',
         completed_at = v_now,
         delivered_at = v_now
   WHERE id         = p_round_id
     AND project_id = p_project_id;

  -- Update project
  SELECT delivery_count INTO v_delivery_count FROM public.projects WHERE id = p_project_id;

  UPDATE public.projects
     SET delivery_count = COALESCE(v_delivery_count, 0) + 1,
         status         = 'waiting_for_feedback'
   WHERE id = p_project_id;

  -- Log event
  INSERT INTO public.project_events (project_id, actor_id, event_type, payload)
  VALUES (p_project_id, v_actor, 'delivery_marked_sent',
    jsonb_build_object('round_id', p_round_id, 'delivered_at', v_now));

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. create_revision_round_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_revision_round_rpc(
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor          uuid := auth.uid();
  v_role           public.user_role;
  v_project        RECORD;
  v_new_round_number int;
  v_round_id       uuid;
  v_stages         public.stage_type[] := ARRAY['initial','advanced','post_production']::public.stage_type[];
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can create revision rounds.';
  END IF;

  -- Lock and read project
  SELECT id, status, current_round_number, view_count
    INTO v_project
    FROM public.projects
   WHERE id = p_project_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;

  IF v_project.status NOT IN ('waiting_for_feedback','delivered') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Revision can only be created after a delivery has been sent.');
  END IF;

  v_new_round_number := v_project.current_round_number + 1;

  -- Guard: no duplicate
  IF EXISTS (
    SELECT 1 FROM public.delivery_rounds
    WHERE project_id = p_project_id AND round_number = v_new_round_number
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Round ' || v_new_round_number || ' already exists.');
  END IF;

  -- Guard: no existing active round
  IF EXISTS (
    SELECT 1 FROM public.delivery_rounds
    WHERE project_id = p_project_id AND status IN ('active','ready_for_admin_review')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'An active round already exists.');
  END IF;

  -- Close current round
  UPDATE public.delivery_rounds
     SET status = 'revision_requested'
   WHERE project_id   = p_project_id
     AND round_number = v_project.current_round_number
     AND status       = 'delivered';

  -- Create new round
  INSERT INTO public.delivery_rounds (project_id, round_number, status)
  VALUES (p_project_id, v_new_round_number, 'active')
  RETURNING id INTO v_round_id;

  -- Insert view_stage_states for all active views × stages
  INSERT INTO public.view_stage_states (project_id, delivery_round_id, project_view_id, stage, status)
  SELECT p_project_id, v_round_id, pv.id, s.stage, 'not_started'
  FROM public.project_views pv
  CROSS JOIN unnest(v_stages) AS s(stage)
  WHERE pv.project_id = p_project_id AND pv.active = true
  ON CONFLICT (delivery_round_id, project_view_id, stage) DO NOTHING;

  -- Update project
  UPDATE public.projects
     SET current_round_number = v_new_round_number,
         status               = 'revision'
   WHERE id = p_project_id;

  -- Log event
  INSERT INTO public.project_events (project_id, actor_id, event_type, payload)
  VALUES (p_project_id, v_actor, 'revision_round_created',
    jsonb_build_object('round_number', v_new_round_number));

  RETURN jsonb_build_object('ok', true, 'round_id', v_round_id, 'round_number', v_new_round_number);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. delete_project_permanently_rpc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_project_permanently_rpc(
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_role   public.user_role;
  v_name   text;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = v_actor;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can permanently delete projects.';
  END IF;

  SELECT name INTO v_name FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;

  -- Cascade ON DELETE handles all child rows; delete in dependency order for safety
  DELETE FROM public.stage_events   WHERE project_id = p_project_id;
  DELETE FROM public.project_events WHERE project_id = p_project_id;
  DELETE FROM public.view_stage_states WHERE project_id = p_project_id;
  DELETE FROM public.delivery_rounds   WHERE project_id = p_project_id;
  DELETE FROM public.project_views     WHERE project_id = p_project_id;
  DELETE FROM public.projects          WHERE id = p_project_id;

  RETURN jsonb_build_object('ok', true, 'deleted_name', v_name);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions: revoke from public, grant to authenticated only
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.ensure_project_workflow_rpc(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_stage_rpc(uuid,uuid,uuid[],public.stage_type,date,public.time_window) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_stage_rpc(uuid,uuid,uuid[],public.stage_type) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_stage_rpc(uuid,uuid,uuid[],public.stage_type,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unblock_stage_rpc(uuid,uuid,uuid,public.stage_type) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_stage_rpc(uuid,uuid,uuid,public.stage_type) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_project_workflow_rpc(text,uuid,date,public.time_window,int,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_delivery_sent_rpc(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_revision_round_rpc(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_project_permanently_rpc(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_project_workflow_rpc(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_stage_rpc(uuid,uuid,uuid[],public.stage_type,date,public.time_window) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_stage_rpc(uuid,uuid,uuid[],public.stage_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_stage_rpc(uuid,uuid,uuid[],public.stage_type,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_stage_rpc(uuid,uuid,uuid,public.stage_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_stage_rpc(uuid,uuid,uuid,public.stage_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_workflow_rpc(text,uuid,date,public.time_window,int,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_delivery_sent_rpc(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_revision_round_rpc(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project_permanently_rpc(uuid) TO authenticated;
