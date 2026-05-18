-- ============================================================
-- 008 - Ensure client management columns
-- ============================================================
-- Some environments were created before client profiles gained status, phone,
-- website, notes, and updated_at. Keep this migration idempotent so those
-- databases can be brought forward safely.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_status') THEN
    CREATE TYPE client_status AS ENUM ('active', 'inactive', 'archived');
  END IF;
END;
$$;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS phone      TEXT,
  ADD COLUMN IF NOT EXISTS website    TEXT,
  ADD COLUMN IF NOT EXISTS notes      TEXT,
  ADD COLUMN IF NOT EXISTS status     client_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_updated_at_clients'
  ) THEN
    CREATE TRIGGER set_updated_at_clients
      BEFORE UPDATE ON clients
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END;
$$;

UPDATE clients
SET updated_at = created_at
WHERE updated_at IS NULL;
