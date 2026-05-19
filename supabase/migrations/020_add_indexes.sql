-- Speed up stage loading, view selection, round lookup, and timeline queries

create index if not exists idx_project_view_rounds_project_view
  on project_view_rounds(project_id, project_view_id);

create index if not exists idx_view_stage_states_round
  on view_stage_states(project_view_round_id);

create index if not exists idx_view_stage_states_view_stage
  on view_stage_states(project_view_id, stage);

create index if not exists idx_view_stage_states_project_round
  on view_stage_states(project_id, project_view_round_id);

create index if not exists idx_view_stage_states_round_view_stage
  on view_stage_states(project_view_round_id, project_view_id, stage);

create index if not exists idx_view_stage_states_status
  on view_stage_states(status);

create index if not exists idx_view_stage_states_eta_status
  on view_stage_states(latest_eta_date, status);

create index if not exists idx_project_views_project_active_number
  on project_views(project_id, active, number);

create index if not exists idx_stage_events_project_created
  on stage_events(project_id, created_at desc);
