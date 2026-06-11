-- ─────────────────────────────────────────────────────────────────────────────
-- 025 — Fix mark_delivery_sent_v2_rpc: FOR UPDATE cannot share a query with
-- an aggregate ("FOR UPDATE is not allowed with aggregate functions").
-- Lock the active rounds in a subquery, aggregate the ids outside it.
-- Function body otherwise identical to migration 024.
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

  -- Lock the active rounds (subquery) so no stage can be started/finished
  -- concurrently between the all-done check and the delivered write, then
  -- aggregate outside the locking query.
  SELECT array_agg(id) INTO v_round_ids
  FROM (
    SELECT r.id
    FROM public.project_view_rounds r
    WHERE r.project_id = p_project_id
      AND r.status = 'active'
      AND r.project_view_id = ANY(v_clean_view_ids)
    FOR UPDATE
  ) locked;

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

REVOKE ALL ON FUNCTION public.mark_delivery_sent_v2_rpc(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_delivery_sent_v2_rpc(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_delivery_sent_v2_rpc(uuid, uuid[]) TO authenticated;
