-- ============================================================
-- 021 - Rewrite data integrity RPC for per-view-rounds schema
-- ============================================================

CREATE OR REPLACE FUNCTION check_data_integrity_rpc()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT jsonb_build_object(
    'ok', true,

    -- 1. Non-archived projects with no active views
    'projects_no_views', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status) ORDER BY p.name), '[]')
      FROM public.projects p
      WHERE p.status != 'archived'
        AND NOT EXISTS (
          SELECT 1 FROM public.project_views v
          WHERE v.project_id = p.id AND v.active = true
        )
    ),

    -- 2. Active views with no active round
    'views_no_active_round', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'project_id', p.id,
        'project_name', p.name,
        'view_id', v.id,
        'view_label', v.label,
        'view_number', v.number
      ) ORDER BY p.name, v.number), '[]')
      FROM public.project_views v
      JOIN public.projects p ON p.id = v.project_id
      WHERE v.active = true
        AND p.status != 'archived'
        AND NOT EXISTS (
          SELECT 1 FROM public.project_view_rounds r
          WHERE r.project_view_id = v.id AND r.status = 'active'
        )
    ),

    -- 3. Active views with more than one active round
    'views_multiple_active_rounds', (
      SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'project_name')), '[]')
      FROM (
        SELECT jsonb_build_object(
          'project_id', p.id,
          'project_name', p.name,
          'view_id', v.id,
          'view_label', v.label,
          'view_number', v.number,
          'active_round_count', COUNT(r.id)
        ) AS row_data
        FROM public.project_view_rounds r
        JOIN public.project_views v ON v.id = r.project_view_id
        JOIN public.projects p ON p.id = v.project_id
        WHERE r.status = 'active'
        GROUP BY p.id, p.name, v.id, v.label, v.number
        HAVING COUNT(r.id) > 1
      ) sub
    ),

    -- 4. Active rounds with fewer than 3 stage states
    'rounds_missing_states', (
      SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'project_name'), (row_data->>'view_number')::int), '[]')
      FROM (
        SELECT jsonb_build_object(
          'round_id', r.id,
          'project_id', p.id,
          'project_name', p.name,
          'view_id', v.id,
          'view_label', v.label,
          'view_number', v.number,
          'round_number', r.round_number,
          'state_count', COALESCE(s.cnt, 0),
          'expected_count', 3
        ) AS row_data
        FROM public.project_view_rounds r
        JOIN public.project_views v ON v.id = r.project_view_id
        JOIN public.projects p ON p.id = v.project_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS cnt
          FROM public.view_stage_states
          WHERE project_view_round_id = r.id
        ) s ON true
        WHERE r.status = 'active'
          AND v.active = true
          AND COALESCE(s.cnt, 0) < 3
      ) sub
    ),

    -- 5. In-progress states with no assigned user
    'in_progress_no_assignee', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'state_id', s.id,
        'project_id', p.id,
        'project_name', p.name,
        'view_label', v.label,
        'view_number', v.number,
        'stage', s.stage
      ) ORDER BY p.name, v.number), '[]')
      FROM public.view_stage_states s
      JOIN public.project_views v ON v.id = s.project_view_id
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.status = 'in_progress'
        AND s.assigned_user_id IS NULL
    ),

    -- 6. Blocked states with no block reason
    'blocked_no_reason', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'state_id', s.id,
        'project_id', p.id,
        'project_name', p.name,
        'view_label', v.label,
        'view_number', v.number,
        'stage', s.stage
      ) ORDER BY p.name, v.number), '[]')
      FROM public.view_stage_states s
      JOIN public.project_views v ON v.id = s.project_view_id
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.status = 'blocked'
        AND (s.block_reason IS NULL OR s.block_reason = '')
    ),

    -- 7. Stage states with impossible timestamps (completed before started)
    'impossible_timestamps', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'state_id', s.id,
        'project_id', p.id,
        'project_name', p.name,
        'view_label', v.label,
        'view_number', v.number,
        'stage', s.stage,
        'started_at', s.started_at,
        'completed_at', s.completed_at
      ) ORDER BY p.name, v.number), '[]')
      FROM public.view_stage_states s
      JOIN public.project_views v ON v.id = s.project_view_id
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.completed_at IS NOT NULL
        AND s.started_at IS NOT NULL
        AND s.completed_at < s.started_at
    )

  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION check_data_integrity_rpc() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_data_integrity_rpc() TO authenticated;
