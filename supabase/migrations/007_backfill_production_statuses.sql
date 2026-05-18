-- ============================================================
-- 007 - Backfill production status vocabulary
-- ============================================================
-- Keep this separate from the enum ALTERs in 004. PostgreSQL cannot safely use
-- newly-added enum values until the transaction that added them has committed.

UPDATE projects SET status = 'in_production'        WHERE status = 'in_progress';
UPDATE projects SET status = 'waiting_for_info'     WHERE status = 'not_started';
UPDATE projects SET status = 'waiting_for_feedback' WHERE status = 'waiting_for_client';
