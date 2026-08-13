-- Imports in this pipeline are exclusively validated PDFs. The RPC therefore
-- receives the same immutable MIME value through the database default.
alter table public.flight_schedule_imports
  alter column mime_type set default 'application/pdf';
