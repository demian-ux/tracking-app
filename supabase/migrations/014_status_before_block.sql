-- Store the stage status before a block so unblock can restore it rather than
-- always resetting to not_started.
ALTER TABLE public.view_stage_states
  ADD COLUMN IF NOT EXISTS status_before_block public.stage_status;
