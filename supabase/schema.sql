-- Story Engine — Supabase schema.
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).

create extension if not exists "pgcrypto";

create table if not exists stories (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  theme text not null,
  age_level text not null,
  character_bible text not null,
  reference_image_path text,          -- path within the "story-images" bucket
  status text not null default 'generating', -- generating | ready | error
  error_message text,
  rating text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  "order" int not null,
  text text not null,
  image_prompt text not null,
  image_path text,                    -- path within the "story-images" bucket
  status text not null default 'draft', -- draft | has_image
  unique (story_id, "order")
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
