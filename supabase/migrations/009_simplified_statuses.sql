-- Add simplified status values to project_status enum
-- Must be separate from backfill (009) so PostgreSQL can use the new values
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'active';
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'revision';
