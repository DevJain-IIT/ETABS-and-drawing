-- CivilSpace Rosetta — Supabase Postgres schema.
-- Run once in the Supabase SQL editor (or via `psql $SUPABASE_DB_URL -f this`).
-- db.py also creates these IF NOT EXISTS on boot, so this is the explicit/source
-- copy plus the storage bucket note.

create table if not exists projects (
  id          text primary key,
  name        text,
  user_email  text,
  status      text,
  created     double precision,
  contract    text,          -- JSON (the data Contract the engine consumes)
  results     text           -- JSON (HITL verdicts + add/delete + name attaches)
);

create table if not exists files (
  id          bigserial primary key,
  project_id  text references projects(id) on delete cascade,
  kind        text,          -- etabs | gfc_pdf | layout_pdf | schedule_pdf
  path        text           -- storage locator (supabase://bucket/key or local path)
);

create index if not exists idx_projects_email on projects(user_email);
create index if not exists idx_files_project   on files(project_id);

-- Storage: create a bucket named per SUPABASE_BUCKET (default "uploads").
-- In the Supabase dashboard: Storage -> New bucket -> name "uploads" (private).
-- The backend uses the service-role key for server-side upload/download.

-- Email-only identity for now (no auth). When real auth lands, add RLS policies:
--   alter table projects enable row level security;
--   create policy "own projects" on projects
--     for all using (user_email = auth.jwt() ->> 'email');
