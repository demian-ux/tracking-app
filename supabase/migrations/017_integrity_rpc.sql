-- ============================================================
-- 017 - Data integrity check RPC (admin-only, read-only)
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

    -- Non-archived projects with no active views
    'projects_no_views', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status)), '[]')
      FROM projects p
      WHERE p.status != 'archived'
        AND NOT EXISTS (
          SELECT 1 FROM project_views v WHERE v.project_id = p.id AND v.active = true
        )
    ),

    -- Non-archived projects with no delivery rounds at all
    'projects_no_rounds', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status)), '[]')
      FROM projects p
      WHERE p.status != 'archived'
        AND NOT EXISTS (
          SELECT 1 FROM delivery_rounds r WHERE r.project_id = p.id
        )
    ),

    -- Projects with more than one active/review round
    'multiple_active_rounds', (
      SELECT COALESCE(jsonb_agg(row_data), '[]')
      FROM (
        SELECT jsonb_build_object(
          'project_id', r.project_id,
          'project_name', p.name,
          'active_round_count', COUNT(r.id)
        ) AS row_data
        FROM delivery_rounds r
        JOIN projects p ON p.id = r.project_id
        WHERE r.status IN ('active', 'ready_for_admin_review')
        GROUP BY r.project_id, p.name
        HAVING COUNT(r.id) > 1
      ) sub
    ),

    -- Active rounds with fewer stage states than expected (views × 3 stages)
    'rounds_missing_states', (
      SELECT COALESCE(jsonb_agg(row_data), '[]')
      FROM (
        SELECT jsonb_build_object(
          'round_id', r.id,
          'project_name', p.name,
          'round_number', r.round_number,
          'state_count', COALESCE(s.cnt, 0),
          'expected_count', v.view_cnt * 3
        ) AS row_data
        FROM delivery_rounds r
        JOIN projects p ON p.id = r.project_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS cnt
          FROM view_stage_states WHERE delivery_round_id = r.id
        ) s ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS view_cnt
          FROM project_views WHERE project_id = r.project_id AND active = true
        ) v ON true
        WHERE r.status IN ('active', 'ready_for_admin_review')
          AND COALESCE(s.cnt, 0) < v.view_cnt * 3
      ) sub
    ),

    -- Stage states where completed_at is before started_at
    'impossible_timestamps', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'project_id', s.project_id,
        'stage', s.stage,
        'status', s.status,
        'started_at', s.started_at,
        'completed_at', s.completed_at
      )), '[]')
      FROM view_stage_states s
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
