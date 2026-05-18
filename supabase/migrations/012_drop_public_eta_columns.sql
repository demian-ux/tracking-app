-- Remove public ETA columns from projects.
-- These were already removed from TypeScript types in the 010 migration cycle.
ALTER TABLE public.projects DROP COLUMN IF EXISTS public_eta_date;
ALTER TABLE public.projects DROP COLUMN IF EXISTS public_eta_time_window;
