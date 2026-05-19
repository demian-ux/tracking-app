-- Add stage_reset to stage_event_type enum
ALTER TYPE stage_event_type ADD VALUE IF NOT EXISTS 'stage_reset';
