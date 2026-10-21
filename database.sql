-- =============================================================================
-- ContractIQ — Supabase schema (single paste-and-run file, FR-14)
-- =============================================================================
-- How to run: Supabase Dashboard → SQL Editor → New query → paste this file → Run.
-- The script is idempotent: re-running it on the same project is safe.
--
-- After the first run, do these one-time steps (see docs/specs/02-database.md):
--   1. Store two Vault secrets used by the cron jobs:
--        select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--        select vault.create_secret('<same value as CRON_SECRET>', 'cron_secret');
--   2. Auth → Providers → Email: enable "Confirm email".
--   3. Auth → URL Configuration: Site URL = NEXT_PUBLIC_SITE_URL,
--      add redirect URL  <NEXT_PUBLIC_SITE_URL>/auth/callback
--
-- Contents
--   1. Extensions          7. RPC functions
--   2. Enum types          8. Views
--   3. Tables              9. Storage bucket + policies
--   4. Indexes            10. Realtime + cron jobs
--   5. Triggers           11. Verification queries
--   6. RLS + grants
-- =============================================================================


-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net   with schema extensions;
create extension if not exists pg_cron  with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;


-- =============================================================================
-- 2. ENUM TYPES
-- =============================================================================
do $$ begin
  create type public.contract_type as enum ('NDA', 'MSA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.contract_status as enum ('uploaded', 'processing', 'completed', 'error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.chat_role as enum ('user', 'assistant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.chat_query_type as enum ('contract', 'history', 'both');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.message_status as enum ('complete', 'error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.feedback_rating as enum ('up', 'down');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.log_kind as enum ('upload', 'extraction', 'chat');
exception when duplicate_object then null; end $$;


-- =============================================================================
-- 3. TABLES (dependency order)
-- =============================================================================

-- 3.1 profiles — 1:1 with auth.users, created by trigger on signup
create table if not exists public.profiles (
  id                       uuid primary key references auth.users (id) on delete cascade,
  email                    text not null,
  full_name                text check (full_name is null or char_length(full_name) <= 120),
  feedback_opt_in          boolean not null default false,
  onboarding_completed_at  timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- 3.2 contracts — one uploaded document + its extracted text + lifecycle status
create table if not exists public.contracts (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.profiles (id) on delete cascade,
  title                   text not null check (char_length(title) between 1 and 200),
  original_filename       text not null check (char_length(original_filename) between 1 and 255),
  contract_type           public.contract_type not null,
  status                  public.contract_status not null default 'uploaded',
  error_code              text,
  error_message           text,
  contract_text           text not null,
  page_count              integer not null check (page_count between 1 and 20),
  word_count              integer not null check (word_count >= 100),
  token_count             integer not null check (token_count between 1 and 15000),
  file_size_bytes         integer not null check (file_size_bytes between 1 and 10485760),
  file_path               text,
  file_deleted_at         timestamptz,
  detected_type_mismatch  boolean not null default false,
  prompt_version          text,
  processing_started_at   timestamptz,
  processed_at            timestamptz,
  review_completed_at     timestamptz,
  last_accessed_at        timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- 3.3 key_terms — extracted (and user-corrected) term results
create table if not exists public.key_terms (
  id                uuid primary key default gen_random_uuid(),
  contract_id       uuid not null references public.contracts (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  term_key          text not null check (term_key ~ '^[a-z0-9_]{2,80}$'),
  term_name         text not null check (char_length(term_name) between 1 and 80),
  value             text check (value is null or char_length(value) <= 2000),
  original_value    text,                       -- AI value, set on insert, immutable
  page_number       integer check (page_number is null or page_number between 1 and 20),
  confidence_score  smallint not null check (confidence_score between 0 and 100),
  source_sentence   text check (source_sentence is null or char_length(source_sentence) <= 2000),
  is_custom         boolean not null default false,
  is_edited         boolean not null default false,
  edited_at         timestamptz,
  sort_order        smallint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint key_terms_contract_term_key_unique unique (contract_id, term_key)
);

-- 3.4 custom_key_terms — user-requested custom terms per contract (max 5)
create table if not exists public.custom_key_terms (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references public.contracts (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  term_name    text not null check (char_length(btrim(term_name)) between 2 and 60),
  is_manual    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- 3.5 chat_sessions — one per contract at MVP
create table if not exists public.chat_sessions (
  id             uuid primary key default gen_random_uuid(),
  contract_id    uuid not null references public.contracts (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  message_count  integer not null default 0 check (message_count between 0 and 200),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint chat_sessions_contract_unique unique (contract_id)
);

-- 3.6 chat_messages
create table if not exists public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.chat_sessions (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         public.chat_role not null,
  content      text not null check (char_length(content) <= 20000),
  cited_pages  integer[] not null default '{}',
  query_type   public.chat_query_type,
  status       public.message_status not null default 'complete',
  created_at   timestamptz not null default now(),
  constraint chat_messages_user_content_length
    check (role <> 'user' or char_length(content) between 1 and 2000)
);

-- 3.7 user_feedback — one rating per user per contract
create table if not exists public.user_feedback (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  contract_id  uuid not null references public.contracts (id) on delete cascade,
  rating       public.feedback_rating not null,
  comment      text check (comment is null or char_length(comment) <= 1000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint user_feedback_user_contract_unique unique (user_id, contract_id)
);

-- 3.8 processing_logs — latency / token / cost telemetry (no contract content)
create table if not exists public.processing_logs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  contract_id        uuid references public.contracts (id) on delete set null,
  kind               public.log_kind not null,
  model              text,
  prompt_version     text,
  prompt_tokens      integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens  integer not null default 0 check (completion_tokens >= 0),
  cached_tokens      integer not null default 0 check (cached_tokens >= 0),
  cost_usd           numeric(10, 5) not null default 0 check (cost_usd >= 0),
  openai_ms          integer check (openai_ms is null or openai_ms >= 0),
  total_ms           integer not null check (total_ms >= 0),
  attempts           smallint not null default 1 check (attempts between 0 and 10),
  success            boolean not null,
  error_code         text,
  created_at         timestamptz not null default now()
);

-- 3.9 rate_limits — fixed-window counters, accessed only via check_rate_limit()
create table if not exists public.rate_limits (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  bucket        text not null check (bucket in ('upload', 'process', 'chat')),
  window_start  timestamptz not null,
  count         integer not null default 0,
  primary key (user_id, bucket, window_start)
);


-- =============================================================================
-- 4. INDEXES
-- =============================================================================
create index if not exists contracts_user_created_idx      on public.contracts (user_id, created_at desc);
create index if not exists contracts_user_type_idx         on public.contracts (user_id, contract_type);
create index if not exists contracts_retention_idx         on public.contracts (last_accessed_at) where file_path is not null;

create index if not exists key_terms_contract_sort_idx     on public.key_terms (contract_id, is_custom, sort_order);
create index if not exists key_terms_user_edited_idx       on public.key_terms (user_id) where is_edited;
create index if not exists key_terms_created_idx           on public.key_terms (created_at);

create unique index if not exists custom_key_terms_contract_name_uidx
  on public.custom_key_terms (contract_id, lower(btrim(term_name)));
create index if not exists custom_key_terms_user_idx       on public.custom_key_terms (user_id);

create index if not exists chat_sessions_user_idx          on public.chat_sessions (user_id);
create index if not exists chat_messages_session_created_idx on public.chat_messages (session_id, created_at);
create index if not exists chat_messages_user_idx          on public.chat_messages (user_id);

create index if not exists user_feedback_contract_idx      on public.user_feedback (contract_id);

create index if not exists processing_logs_user_idx        on public.processing_logs (user_id);
create index if not exists processing_logs_contract_idx    on public.processing_logs (contract_id);
create index if not exists processing_logs_kind_created_idx on public.processing_logs (kind, created_at);

create index if not exists rate_limits_window_idx          on public.rate_limits (window_start);


-- =============================================================================
-- 5. TRIGGERS
-- =============================================================================

-- 5.1 updated_at maintenance
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists contracts_set_updated_at on public.contracts;
create trigger contracts_set_updated_at before update on public.contracts
  for each row execute function public.set_updated_at();

drop trigger if exists key_terms_set_updated_at on public.key_terms;
create trigger key_terms_set_updated_at before update on public.key_terms
  for each row execute function public.set_updated_at();

drop trigger if exists chat_sessions_set_updated_at on public.chat_sessions;
create trigger chat_sessions_set_updated_at before update on public.chat_sessions
  for each row execute function public.set_updated_at();

drop trigger if exists user_feedback_set_updated_at on public.user_feedback;
create trigger user_feedback_set_updated_at before update on public.user_feedback
  for each row execute function public.set_updated_at();

-- 5.2 Create a profile for every new auth user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, feedback_opt_in)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), ''),
    coalesce(new.raw_user_meta_data ->> 'feedback_opt_in' = 'true', false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5.3 Keep profiles.email in sync when the auth email changes
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- 5.4 Child rows must belong to the same user as their contract
create or replace function public.enforce_contract_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if new.contract_id is null then
    return new;
  end if;
  select c.user_id into v_owner from public.contracts c where c.id = new.contract_id;
  if v_owner is null or v_owner <> new.user_id then
    raise exception 'user_id does not match contract owner' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists key_terms_enforce_owner on public.key_terms;
create trigger key_terms_enforce_owner before insert or update of user_id, contract_id on public.key_terms
  for each row execute function public.enforce_contract_owner();

drop trigger if exists custom_key_terms_enforce_owner on public.custom_key_terms;
create trigger custom_key_terms_enforce_owner before insert or update of user_id, contract_id on public.custom_key_terms
  for each row execute function public.enforce_contract_owner();

drop trigger if exists chat_sessions_enforce_owner on public.chat_sessions;
create trigger chat_sessions_enforce_owner before insert or update of user_id, contract_id on public.chat_sessions
  for each row execute function public.enforce_contract_owner();

drop trigger if exists user_feedback_enforce_owner on public.user_feedback;
create trigger user_feedback_enforce_owner before insert or update of user_id, contract_id on public.user_feedback
  for each row execute function public.enforce_contract_owner();

drop trigger if exists processing_logs_enforce_owner on public.processing_logs;
create trigger processing_logs_enforce_owner before insert on public.processing_logs
  for each row execute function public.enforce_contract_owner();

-- 5.5 Max 5 custom terms per contract (FR-05)
create or replace function public.enforce_custom_term_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- serialise concurrent inserts for the same contract
  perform 1 from public.contracts where id = new.contract_id for update;
  select count(*) into v_count from public.custom_key_terms where contract_id = new.contract_id;
  if v_count >= 5 then
    raise exception 'CUSTOM_TERM_LIMIT: a contract can have at most 5 custom terms'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists custom_key_terms_limit on public.custom_key_terms;
create trigger custom_key_terms_limit before insert on public.custom_key_terms
  for each row execute function public.enforce_custom_term_limit();

-- 5.6 key_terms edit tracking: original_value = AI value (immutable),
--     is_edited / edited_at derived from value vs original_value (US-009)
create or replace function public.track_key_term_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.original_value := new.value;
    new.is_edited      := false;
    new.edited_at      := null;
  else
    new.original_value := old.original_value;
    if new.value is distinct from old.value then
      new.is_edited := new.value is distinct from old.original_value;
      new.edited_at := case when new.is_edited then now() else null end;
    else
      new.is_edited := old.is_edited;
      new.edited_at := old.edited_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists key_terms_track_edit on public.key_terms;
create trigger key_terms_track_edit before insert or update on public.key_terms
  for each row execute function public.track_key_term_edit();

-- 5.7 chat_messages: owner check, 200-message cap, message_count maintenance
create or replace function public.before_chat_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select s.user_id into v_owner from public.chat_sessions s where s.id = new.session_id;
  if v_owner is null or v_owner <> new.user_id then
    raise exception 'user_id does not match chat session owner' using errcode = '42501';
  end if;

  update public.chat_sessions
     set message_count = message_count + 1
   where id = new.session_id
     and message_count < 200;
  if not found then
    raise exception 'CHAT_LIMIT_REACHED: a chat session can hold at most 200 messages'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists chat_messages_before_insert on public.chat_messages;
create trigger chat_messages_before_insert before insert on public.chat_messages
  for each row execute function public.before_chat_message_insert();


-- =============================================================================
-- 6. ROW LEVEL SECURITY + GRANTS
-- =============================================================================
-- Principle: users read only their own rows. Users write directly only where the
-- app needs it (contract title/access/review timestamps, key-term value, profile
-- settings, feedback). All other writes go through Edge Functions using the
-- service role, which bypasses RLS and always scopes by the JWT's user id.

alter table public.profiles         enable row level security;
alter table public.contracts        enable row level security;
alter table public.key_terms        enable row level security;
alter table public.custom_key_terms enable row level security;
alter table public.chat_sessions    enable row level security;
alter table public.chat_messages    enable row level security;
alter table public.user_feedback    enable row level security;
alter table public.processing_logs  enable row level security;
alter table public.rate_limits      enable row level security;

-- anon never touches app tables
revoke all on public.profiles, public.contracts, public.key_terms, public.custom_key_terms,
              public.chat_sessions, public.chat_messages, public.user_feedback,
              public.processing_logs, public.rate_limits
  from anon;

-- Supabase default privileges grant ALL on new tables; TRUNCATE bypasses RLS
revoke truncate, references, trigger
  on public.profiles, public.contracts, public.key_terms, public.custom_key_terms,
     public.chat_sessions, public.chat_messages, public.user_feedback,
     public.processing_logs, public.rate_limits
  from authenticated;

-- rate_limits is internal only
revoke all on public.rate_limits from authenticated;

-- 6.1 profiles: select / update own (limited columns)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, feedback_opt_in, onboarding_completed_at) on public.profiles to authenticated;

-- 6.2 contracts: select / update (limited columns) / delete own; insert via Edge Function only
drop policy if exists "contracts_select_own" on public.contracts;
create policy "contracts_select_own" on public.contracts
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "contracts_update_own" on public.contracts;
create policy "contracts_update_own" on public.contracts
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "contracts_delete_own" on public.contracts;
create policy "contracts_delete_own" on public.contracts
  for delete to authenticated using (user_id = (select auth.uid()));

revoke insert, update on public.contracts from authenticated;
grant update (title, last_accessed_at, review_completed_at) on public.contracts to authenticated;

-- 6.3 key_terms: select own; update own (value column only); insert/delete via Edge Function / cascade
drop policy if exists "key_terms_select_own" on public.key_terms;
create policy "key_terms_select_own" on public.key_terms
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "key_terms_update_own" on public.key_terms;
create policy "key_terms_update_own" on public.key_terms
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke insert, update, delete on public.key_terms from authenticated;
grant update (value) on public.key_terms to authenticated;

-- 6.4 custom_key_terms: select own
drop policy if exists "custom_key_terms_select_own" on public.custom_key_terms;
create policy "custom_key_terms_select_own" on public.custom_key_terms
  for select to authenticated using (user_id = (select auth.uid()));

revoke insert, update, delete on public.custom_key_terms from authenticated;

-- 6.5 chat_sessions / chat_messages: select own (writes via chat Edge Function)
drop policy if exists "chat_sessions_select_own" on public.chat_sessions;
create policy "chat_sessions_select_own" on public.chat_sessions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "chat_messages_select_own" on public.chat_messages;
create policy "chat_messages_select_own" on public.chat_messages
  for select to authenticated using (user_id = (select auth.uid()));

revoke insert, update, delete on public.chat_sessions, public.chat_messages from authenticated;

-- 6.6 user_feedback: full CRUD on own rows
drop policy if exists "user_feedback_select_own" on public.user_feedback;
create policy "user_feedback_select_own" on public.user_feedback
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "user_feedback_insert_own" on public.user_feedback;
create policy "user_feedback_insert_own" on public.user_feedback
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "user_feedback_update_own" on public.user_feedback;
create policy "user_feedback_update_own" on public.user_feedback
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "user_feedback_delete_own" on public.user_feedback;
create policy "user_feedback_delete_own" on public.user_feedback
  for delete to authenticated using (user_id = (select auth.uid()));

revoke update on public.user_feedback from authenticated;
grant update (rating, comment) on public.user_feedback to authenticated;

-- 6.7 processing_logs: select own (writes via Edge Functions)
drop policy if exists "processing_logs_select_own" on public.processing_logs;
create policy "processing_logs_select_own" on public.processing_logs
  for select to authenticated using (user_id = (select auth.uid()));

revoke insert, update, delete on public.processing_logs from authenticated;

-- 6.8 rate_limits: no policies (deny all to anon/authenticated)


-- =============================================================================
-- 7. RPC FUNCTIONS
-- =============================================================================

-- 7.1 Dashboard stats for the calling user (FR-10)
create or replace function public.get_dashboard_stats()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'total', count(*),
    'by_type', jsonb_build_object(
      'NDA', count(*) filter (where c.contract_type = 'NDA'),
      'MSA', count(*) filter (where c.contract_type = 'MSA')
    ),
    'by_status', jsonb_build_object(
      'uploaded',   count(*) filter (where c.status = 'uploaded'),
      'processing', count(*) filter (where c.status = 'processing'),
      'completed',  count(*) filter (where c.status = 'completed'),
      'error',      count(*) filter (where c.status = 'error')
    )
  )
  from public.contracts c
  where c.user_id = (select auth.uid());
$$;

revoke all on function public.get_dashboard_stats() from public, anon;
grant execute on function public.get_dashboard_stats() to authenticated;

-- 7.2 Fixed-window rate limiter. Returns true when the request is allowed.
create or replace function public.check_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count  integer;
begin
  insert into public.rate_limits as rl (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, v_window, 1)
  on conflict (user_id, bucket, window_start)
    do update set count = rl.count + 1
  returning rl.count into v_count;
  return v_count <= p_limit;
end;
$$;

revoke all on function public.check_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(uuid, text, integer, integer) to service_role;

-- 7.3 Atomically claim a contract for processing and store its custom terms.
--     Returns the contract row, or raises:
--       NOT_FOUND           (P0002) contract missing / not owned
--       ALREADY_PROCESSING  (P0001) another run started < 2 minutes ago
create or replace function public.start_processing(
  p_contract_id uuid,
  p_user_id uuid,
  p_contract_type public.contract_type,
  p_custom_terms text[]
)
returns public.contracts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.contracts;
  v_term     text;
begin
  select * into v_contract
    from public.contracts
   where id = p_contract_id and user_id = p_user_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_contract.status = 'processing'
     and v_contract.processing_started_at > now() - interval '2 minutes' then
    raise exception 'ALREADY_PROCESSING' using errcode = 'P0001';
  end if;

  delete from public.custom_key_terms where contract_id = p_contract_id;

  foreach v_term in array coalesce(p_custom_terms, '{}'::text[]) loop
    insert into public.custom_key_terms (contract_id, user_id, term_name)
    values (p_contract_id, p_user_id, btrim(v_term));
  end loop;

  update public.contracts
     set status = 'processing',
         contract_type = p_contract_type,
         error_code = null,
         error_message = null,
         processing_started_at = now()
   where id = p_contract_id
  returning * into v_contract;

  return v_contract;
end;
$$;

revoke all on function public.start_processing(uuid, uuid, public.contract_type, text[]) from public, anon, authenticated;
grant execute on function public.start_processing(uuid, uuid, public.contract_type, text[]) to service_role;

-- 7.4 Atomically replace key terms and mark the contract completed.
--     p_terms: jsonb array of
--       { term_key, term_name, value, page_number, confidence_score,
--         source_sentence, is_custom, sort_order }
create or replace function public.save_extraction_results(
  p_contract_id uuid,
  p_user_id uuid,
  p_terms jsonb,
  p_detected_type_mismatch boolean,
  p_prompt_version text
)
returns setof public.key_terms
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.contracts
   where id = p_contract_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  delete from public.key_terms where contract_id = p_contract_id;

  insert into public.key_terms (
    contract_id, user_id, term_key, term_name, value, page_number,
    confidence_score, source_sentence, is_custom, sort_order
  )
  select
    p_contract_id,
    p_user_id,
    t ->> 'term_key',
    t ->> 'term_name',
    t ->> 'value',
    (t ->> 'page_number')::integer,
    (t ->> 'confidence_score')::smallint,
    t ->> 'source_sentence',
    coalesce((t ->> 'is_custom')::boolean, false),
    coalesce((t ->> 'sort_order')::smallint, 0)
  from jsonb_array_elements(p_terms) as t;

  update public.contracts
     set status = 'completed',
         error_code = null,
         error_message = null,
         detected_type_mismatch = coalesce(p_detected_type_mismatch, false),
         prompt_version = p_prompt_version,
         processed_at = now()
   where id = p_contract_id;

  return query
    select * from public.key_terms
     where contract_id = p_contract_id
     order by is_custom, sort_order;
end;
$$;

revoke all on function public.save_extraction_results(uuid, uuid, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.save_extraction_results(uuid, uuid, jsonb, boolean, text) to service_role;

-- 7.5 Health check used by /api/health (callable without login; reads no data)
create or replace function public.health_check()
returns boolean
language sql
stable
set search_path = ''
as $$
  select true;
$$;

grant execute on function public.health_check() to anon, authenticated;

-- 7.6 Invoke an Edge Function from pg_cron (uses Vault secrets project_url + cron_secret)
create or replace function public.invoke_edge_function(p_function_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url        text;
  v_secret     text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise exception 'Vault secrets "project_url" and "cron_secret" must be set';
  end if;

  select net.http_post(
    url                  := rtrim(v_url, '/') || '/functions/v1/' || p_function_name,
    headers              := jsonb_build_object(
                              'Content-Type', 'application/json',
                              'x-cron-secret', v_secret
                            ),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_edge_function(text) from public, anon, authenticated;


-- =============================================================================
-- 8. VIEWS (internal analytics — not exposed to anon/authenticated)
-- =============================================================================

-- 8.1 Correction-rate counts (no contract content) — all users
create or replace view public.term_corrections
with (security_invoker = true) as
select
  (kt.created_at at time zone 'utc')::date                as day,
  c.contract_type,
  kt.term_key,
  kt.is_custom,
  count(*)                                                as total_terms,
  count(*) filter (where kt.is_edited)                    as corrected_terms
from public.key_terms kt
join public.contracts c on c.id = kt.contract_id
group by 1, 2, 3, 4;

-- 8.2 Corrected values for prompt review — opted-in users only
create or replace view public.term_correction_samples
with (security_invoker = true) as
select
  kt.id                as key_term_id,
  c.contract_type,
  kt.term_key,
  kt.term_name,
  kt.original_value,
  kt.value             as corrected_value,
  kt.page_number,
  kt.confidence_score,
  kt.source_sentence,
  kt.edited_at
from public.key_terms kt
join public.contracts c on c.id = kt.contract_id
join public.profiles  p on p.id = kt.user_id
where kt.is_edited
  and p.feedback_opt_in;

revoke all on public.term_corrections, public.term_correction_samples from anon, authenticated;


-- =============================================================================
-- 9. STORAGE — private "contracts" bucket
-- =============================================================================
-- Object key inside the bucket: {user_id}/{contract_id}/{filename}.pdf
-- (full path: contracts/{user_id}/{contract_id}/{filename}.pdf)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contracts', 'contracts', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "contracts_storage_insert_own" on storage.objects;
create policy "contracts_storage_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "contracts_storage_select_own" on storage.objects;
create policy "contracts_storage_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "contracts_storage_delete_own" on storage.objects;
create policy "contracts_storage_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );


-- =============================================================================
-- 10. REALTIME + CRON JOBS
-- =============================================================================

-- 10.1 Broadcast contracts row changes (processing status) to the owner (RLS applies)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contracts'
  ) then
    alter publication supabase_realtime add table public.contracts;
  end if;
end $$;

-- 10.2 Scheduled jobs (cron.schedule upserts by job name)
select cron.schedule(
  'contractiq-retention-cleanup',
  '0 3 * * *',                                   -- daily 03:00 UTC
  $$select public.invoke_edge_function('retention-cleanup')$$
);

select cron.schedule(
  'contractiq-daily-alerts',
  '0 8 * * *',                                   -- daily 08:00 UTC
  $$select public.invoke_edge_function('daily-alerts')$$
);

select cron.schedule(
  'contractiq-rate-limit-purge',
  '15 * * * *',                                  -- hourly at :15
  $$delete from public.rate_limits where window_start < now() - interval '1 day'$$
);

-- =============================================================================
-- 11. VERIFICATION (run after applying; expected results in comments)
-- =============================================================================
-- select tablename, rowsecurity from pg_tables where schemaname = 'public';             -- all true
-- select count(*) from pg_policies where schemaname = 'public';                          -- 15
-- select count(*) from pg_policies
--  where schemaname = 'storage' and policyname like 'contracts_storage_%';               -- 3
-- select id, public, file_size_limit from storage.buckets where id = 'contracts';        -- false, 10485760
-- select jobname, schedule from cron.job where jobname like 'contractiq-%';              -- 3 rows
-- select privilege_type from information_schema.role_table_grants
--  where grantee = 'authenticated' and privilege_type = 'TRUNCATE'
--    and table_schema = 'public';                                                        -- 0 rows

-- =============================================================================
-- END
-- =============================================================================
