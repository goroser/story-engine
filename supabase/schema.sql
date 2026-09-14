-- Story Engine — Supabase schema.
--
-- Safe to run on a fresh project OR on one that already has stories/chunks
-- tables from the original spec's manual prototype (id, title, theme,
-- age_level, character_bible, created_at, rating, notes / id, story_id,
-- "order", text, image_prompt, image_url, status) — every statement here is
-- additive (create-if-missing, add-column-if-missing) and never drops or
-- overwrites existing rows.

create extension if not exists "pgcrypto";

create table if not exists stories (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  theme text not null,
  age_level text not null,
  character_bible text not null,
  created_at timestamptz not null default now(),
  rating text,
  notes text
);

-- Columns the self-service generation pipeline needs on top of the
-- original spec's data model (progress tracking + the approved character
-- reference sheet). default 'ready' so any pre-existing row (e.g. a
-- hand-seeded prototype story) shows up immediately rather than looking
-- like it's stuck generating.
alter table stories add column if not exists status text not null default 'ready';
alter table stories add column if not exists error_message text;
alter table stories add column if not exists reference_image_path text;

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  "order" int not null,
  text text not null,
  image_prompt text not null,
  image_url text,
  status text not null default 'draft'
);

create index if not exists chunks_story_id_idx on chunks(story_id);

-- RLS is enabled with NO policies at all: the anon/public role can read or
-- write nothing, ever. The site's browser code never talks to Supabase
-- directly — it only has our own Vercel Basic-Auth-gated API routes
-- (web/api/*.js), which use the service_role key (bypasses RLS) server-side.
-- That keeps a single password gate in front of both the pages AND the
-- data/images, instead of a second, weaker path via a public anon key.
alter table stories enable row level security;
alter table chunks enable row level security;

-- Storage bucket for images (reference sheets + chunk illustrations).
-- Private, not public — served only through web/api/image.js, which
-- streams bytes server-side via the service_role key. Same reasoning as
-- above: no direct-to-Supabase path that would bypass our password wall.
insert into storage.buckets (id, name, public)
values ('story-images', 'story-images', false)
on conflict (id) do nothing;
