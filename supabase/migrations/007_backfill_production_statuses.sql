-- ============================================================
-- 007 - Backfill production status vocabulary
-- ============================================================
-- Kept separate from 004's enum ALTERs: PostgreSQL cannot safely use
-- newly-added enum values until the transaction that added them commits.
--
-- Uses status::text in WHERE clauses so PostgreSQL does not validate
-- the old literal values as enum members at parse time.
--
-- The target values (in_production, waiting_for_info, waiting_for_feedback)
-- are added by 004. If 004 was not applied, skip — migration 010 will map
-- any remaining legacy rows directly to the simplified statuses.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'in_production'
      AND enumtypid = 'project_status'::regtype
  ) THEN
    UPDATE projects SET status = 'in_production'
      WHERE status::text = 'in_progress';

    UPDATE projects SET status = 'waiting_for_info'
      WHERE status::text = 'not_started';

    UPDATE projects SET status = 'waiting_for_feedback'
      WHERE status::text = 'waiting_for_client';
  END IF;
END $$;
