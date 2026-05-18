-- ============================================================
-- 004 – Production statuses, block reason, admin review step
-- ============================================================

-- 1. New project_status values
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'waiting_for_info';
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'ready_to_start';
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'in_production';
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'waiting_for_feedback';

-- 2. New round_status for admin review gate
ALTER TYPE round_status ADD VALUE IF NOT EXISTS 'ready_for_admin_review';

-- 3. New project event types
ALTER TYPE project_event_type ADD VALUE IF NOT EXISTS 'project_status_changed';
ALTER TYPE project_event_type ADD VALUE IF NOT EXISTS 'admin_review_approved';

-- 4. Block reason on view_stage_states
ALTER TABLE view_stage_states
  ADD COLUMN IF NOT EXISTS block_reason TEXT;
