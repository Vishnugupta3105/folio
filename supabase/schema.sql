-- Folio — schema. Run this once in the Supabase SQL editor.
--
-- Ownership is enforced twice: row-level security here, and the userId filter
-- every adapter method applies. The service-role key used by the server bypasses
-- RLS, so the adapter's filtering is the primary gate; RLS is the backstop that
-- protects against a leaked anon key.

create extension if not exists "pgcrypto";

create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null unique,
  -- scrypt, salted per user. Never the password itself.
  password_hash text not null,
  created_at    timestamptz not null default now()
);
-- `create table if not exists` above is a no-op once the table exists, so a
-- database created before password sign-in keeps its passwordless `app_users`
-- and re-running this file repairs nothing. Add the column explicitly. It is
-- nullable because existing rows have no hash; those accounts can never sign in
-- and should be deleted (see supabase/migrations/001_passwords.sql).
alter table app_users add column if not exists password_hash text;


create table if not exists books (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references app_users(id) on delete cascade,
  title          text not null,
  author         text,
  format         text not null check (format in ('pdf','epub')),
  file_key       text not null,
  cover_url      text,
  page_count     integer not null default 0,
  page_labels    jsonb,
  status         text not null default 'reading' check (status in ('reading','finished','want-to-read')),
  index_state    text not null default 'pending' check (index_state in ('pending','indexing','ready','failed')),
  created_at     timestamptz not null default now(),
  last_opened_at timestamptz
);
create index if not exists books_user_idx on books(user_id, last_opened_at desc nulls last);

create table if not exists reading_progress (
  user_id       uuid not null references app_users(id) on delete cascade,
  book_id       uuid not null references books(id) on delete cascade,
  page          integer not null default 1,
  progress      real not null default 0,
  chapter       text,
  tts_sentence  integer,
  updated_at    timestamptz not null default now(),
  primary key (user_id, book_id)
);

create table if not exists highlights (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references app_users(id) on delete cascade,
  book_id      uuid not null references books(id) on delete cascade,
  page         integer not null,
  text         text not null,
  color        text not null default 'amber',
  start_offset integer not null default 0,
  end_offset   integer not null default 0,
  -- EPUB range; null for PDFs, which use the offsets above.
  cfi          text,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists highlights_book_idx on highlights(book_id, page);

create table if not exists notes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references app_users(id) on delete cascade,
  book_id       uuid not null references books(id) on delete cascade,
  page          integer not null,
  selected_text text,
  content       text not null,
  created_at    timestamptz not null default now()
);
create index if not exists notes_book_idx on notes(book_id, page);

create table if not exists bookmarks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references app_users(id) on delete cascade,
  book_id    uuid not null references books(id) on delete cascade,
  page       integer not null,
  label      text,
  created_at timestamptz not null default now()
);
create index if not exists bookmarks_book_idx on bookmarks(book_id, page);

-- One retrievable unit of book text. `page` is the physical page index and is
-- what every AI citation resolves against.
create table if not exists chunks (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references books(id) on delete cascade,
  page        integer not null,
  chapter     text,
  chunk_index integer not null,
  text        text not null
);
create index if not exists chunks_book_idx on chunks(book_id, chunk_index);
create index if not exists chunks_page_idx on chunks(book_id, page);
-- Lexical search for the in-book "search inside" feature and BM25 retrieval.
create index if not exists chunks_fts_idx on chunks using gin (to_tsvector('english', text));

create table if not exists ai_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references app_users(id) on delete cascade,
  book_id       uuid not null references books(id) on delete cascade,
  role          text not null check (role in ('user','assistant')),
  content       text not null,
  page          integer,
  selected_text text,
  source_pages  integer[],
  created_at    timestamptz not null default now()
);
create index if not exists ai_messages_book_idx on ai_messages(book_id, created_at);

create table if not exists preferences (
  user_id       uuid primary key references app_users(id) on delete cascade,
  theme         text not null default 'system',
  voice_replies boolean not null default false,
  tts_voice     text,
  tts_rate      real not null default 1,
  spread        text not null default 'double'
);

create table if not exists reading_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references app_users(id) on delete cascade,
  book_id         uuid not null references books(id) on delete cascade,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  pages_read      integer not null default 0,
  questions_asked integer not null default 0
);

-- RLS: deny by default. The server uses the service-role key and scopes every
-- query itself; these policies mean a leaked anon key grants nothing.
do $$
declare t text;
begin
  foreach t in array array['app_users','books','reading_progress','highlights','notes',
                           'bookmarks','chunks','ai_messages','preferences','reading_sessions']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Private storage bucket for the uploaded book files and generated covers.
insert into storage.buckets (id, name, public)
values ('books', 'books', false)
on conflict (id) do nothing;
