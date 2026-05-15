-- Client status enum
CREATE TYPE client_status AS ENUM ('active', 'inactive', 'archived');

-- Add missing columns to clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS phone      TEXT,
  ADD COLUMN IF NOT EXISTS website    TEXT,
  ADD COLUMN IF NOT EXISTS notes      TEXT,
  ADD COLUMN IF NOT EXISTS status     client_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW();

-- updated_at trigger (reuses the function from migration 001)
CREATE TRIGGER set_updated_at_clients
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Backfill updated_at for any existing rows
UPDATE clients SET updated_at = created_at WHERE updated_at = NOW() AND created_at < NOW();
