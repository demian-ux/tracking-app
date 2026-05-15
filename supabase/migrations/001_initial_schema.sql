-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE user_role AS ENUM ('admin', 'team_member', 'client');
CREATE TYPE project_status AS ENUM (
  'not_started', 'in_progress', 'waiting_for_client',
  'ready_to_deliver', 'delivered', 'revision_in_progress', 'archived'
);
CREATE TYPE stage_type AS ENUM ('initial', 'advanced', 'post_production');
CREATE TYPE stage_status AS ENUM ('not_started', 'in_progress', 'done', 'blocked', 'reopened');
CREATE TYPE round_status AS ENUM ('active', 'delivered', 'revision_requested');
CREATE TYPE time_window AS ENUM ('Midday', 'Afternoon', 'EOD');
CREATE TYPE stage_event_type AS ENUM (
  'stage_started', 'stage_eta_changed', 'stage_finished',
  'stage_reopened', 'stage_blocked', 'stage_unblocked'
);
CREATE TYPE project_event_type AS ENUM (
  'project_created', 'delivery_date_changed', 'public_eta_changed',
  'view_count_changed', 'delivery_marked_sent', 'revision_round_created',
  'project_archived', 'information_received', 'information_completed'
);

-- users (synced from auth.users)
CREATE TABLE users (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  role       user_role NOT NULL DEFAULT 'team_member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- clients
CREATE TABLE clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  contact_name  TEXT,
  contact_email TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- projects
CREATE TABLE projects (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              UUID REFERENCES clients(id) ON DELETE SET NULL,
  name                   TEXT NOT NULL,
  status                 project_status NOT NULL DEFAULT 'not_started',
  delivery_date          DATE,
  delivery_time_window   time_window,
  public_eta_date        DATE,
  public_eta_time_window time_window,
  view_count             INT NOT NULL DEFAULT 1 CHECK (view_count >= 1),
  current_round_number   INT NOT NULL DEFAULT 0,
  delivery_count         INT NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- project_views
CREATE TABLE project_views (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number     INT NOT NULL,
  label      TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, number)
);

-- delivery_rounds
CREATE TABLE delivery_rounds (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  status       round_status NOT NULL DEFAULT 'active',
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, round_number)
);

-- view_stage_states
CREATE TABLE view_stage_states (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  delivery_round_id      UUID NOT NULL REFERENCES delivery_rounds(id) ON DELETE CASCADE,
  project_view_id        UUID NOT NULL REFERENCES project_views(id) ON DELETE CASCADE,
  stage                  stage_type NOT NULL,
  status                 stage_status NOT NULL DEFAULT 'not_started',
  assigned_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at             TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,
  latest_eta_date        DATE,
  latest_eta_time_window time_window,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (delivery_round_id, project_view_id, stage)
);

-- stage_events (append-only)
CREATE TABLE stage_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  delivery_round_id UUID NOT NULL REFERENCES delivery_rounds(id) ON DELETE CASCADE,
  project_view_id   UUID NOT NULL REFERENCES project_views(id) ON DELETE CASCADE,
  stage             stage_type NOT NULL,
  event_type        stage_event_type NOT NULL,
  actor_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  eta_date          DATE,
  eta_time_window   time_window,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- project_events (append-only)
CREATE TABLE project_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type project_event_type NOT NULL,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_project_views_project_id ON project_views(project_id);
CREATE INDEX idx_delivery_rounds_project_id ON delivery_rounds(project_id);
CREATE INDEX idx_view_stage_states_project_id ON view_stage_states(project_id);
CREATE INDEX idx_view_stage_states_round_id ON view_stage_states(delivery_round_id);
CREATE INDEX idx_stage_events_project_id ON stage_events(project_id);
CREATE INDEX idx_project_events_project_id ON project_events(project_id);
CREATE INDEX idx_projects_status ON projects(status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_projects
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_view_stage_states
  BEFORE UPDATE ON view_stage_states
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Note: public.users rows are created by the app on first login (ensureUserProfile),
-- not by a database trigger. This avoids auth schema permission issues across
-- different Supabase project tiers.
