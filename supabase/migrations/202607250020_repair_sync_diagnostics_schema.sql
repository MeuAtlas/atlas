-- The diagnostics table may predate the complete schema from migration 016.
-- CREATE TABLE IF NOT EXISTS does not add columns to an existing table.
alter table public.credit_card_sync_diagnostics
  add column if not exists classification_counts jsonb
    not null default '{}'::jsonb;

notify pgrst, 'reload schema';
