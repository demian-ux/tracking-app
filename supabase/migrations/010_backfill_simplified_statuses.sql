-- Add notes column to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS notes TEXT;

-- Collapse legacy statuses into simplified model
UPDATE projects SET status = 'active'
WHERE status IN ('waiting_for_info', 'ready_to_start', 'in_production', 'ready_to_deliver', 'not_started', 'in_progress');

UPDATE projects SET status = 'revision'
WHERE status = 'revision_in_progress';

UPDATE projects SET status = 'waiting_for_feedback'
WHERE status = 'waiting_for_client';
