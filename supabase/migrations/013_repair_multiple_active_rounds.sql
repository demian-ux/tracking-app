-- For projects that ended up with more than one active round (due to the old
-- createRevisionRound not closing the previous round), keep only the highest-numbered
-- active round and set the rest to 'revision_requested'.

WITH ranked AS (
  SELECT
    id,
    project_id,
    round_number,
    ROW_NUMBER() OVER (
      PARTITION BY project_id
      ORDER BY round_number DESC
    ) AS rn
  FROM public.delivery_rounds
  WHERE status IN ('active', 'ready_for_admin_review')
)
UPDATE public.delivery_rounds
SET status = 'revision_requested'
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- Sync projects.current_round_number to match the highest round that exists.
UPDATE public.projects p
SET current_round_number = latest.max_round
FROM (
  SELECT project_id, MAX(round_number) AS max_round
  FROM public.delivery_rounds
  GROUP BY project_id
) latest
WHERE latest.project_id = p.id
  AND p.current_round_number IS DISTINCT FROM latest.max_round;
