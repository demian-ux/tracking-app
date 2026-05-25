-- Add 'delivery_undone' to project_event_type so admins can revert a sent delivery
-- and the event is auditable.

ALTER TYPE project_event_type ADD VALUE IF NOT EXISTS 'delivery_undone';
