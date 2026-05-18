-- ============================================================
-- 010 - Backfill simplified status vocabulary
-- ============================================================
-- Kept separate from 009's enum ALTERs: PostgreSQL cannot safely use
-- newly-added enum values until the transaction that added them commits.
--
-- Uses status::text in WHERE clauses so PostgreSQL does not validate
-- old literal values as enum members at parse time. This makes the
-- migration safe regardless of which prior migrations were applied.

-- Add notes column
ALTER TABLE projects ADD COLUMN IF NOT EXISTS notes TEXT;

-- Collapse every legacy / intermediate status into the simplified model.
-- All target values (active, revision, waiting_for_feedback) exist after 009.

UPDATE projects SET status = 'active'
WHERE status::text IN (
  'not_started', 'in_progress',
  'waiting_for_info', 'ready_to_start', 'in_production', 'ready_to_deliver'
);

UPDATE projects SET status = 'revision'
WHERE status::text = 'revision_in_progress';

UPDATE projects SET status = 'waiting_for_feedback'
WHERE status::text = 'waiting_for_client';
