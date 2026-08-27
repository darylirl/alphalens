-- The Ledger's Telegram mirror: what has already been posted, and nothing else.
--
-- `ledger_calls` is append-only and its only writable column group is the
-- resolution block, so the "have I posted this?" bit cannot live on the call.
-- It lives here, in a table that is explicitly NOT part of the record: the
-- Ledger is the source of truth, the channel is a mirror, and this table is
-- the mirror's bookkeeping. Losing it would cause a re-post, never a wrong
-- number.
--
-- One row per (call, phase). 'publish' is the announcement of a new call;
-- 'resolution' is the announcement of its scored outcome. The primary key is
-- what makes the publisher idempotent across restarts and across the two
-- processes that can announce (the verify worker at publish time, the scorer
-- at resolution time and on its sweep) — not application memory.

create table if not exists ledger_telegram_posts (
  call_id     bigint      not null references ledger_calls (id),
  phase       text        not null,
  claimed_at  timestamptz not null default now(),
  posted_at   timestamptz,
  message_id  bigint,
  channel     text,
  attempts    integer     not null default 0,
  last_error  text,

  primary key (call_id, phase),
  constraint ledger_telegram_posts_phase check (phase in ('publish', 'resolution')),
  constraint ledger_telegram_posts_attempts check (attempts >= 0)
);

comment on table ledger_telegram_posts is
  'Bookkeeping for the Ledger''s Telegram mirror: one row per (call, phase) that has been claimed for posting. Not part of the Ledger record.';

create index if not exists idx_ledger_telegram_posts_unposted
  on ledger_telegram_posts (claimed_at)
  where posted_at is null;

-- ── What still needs announcing ─────────────────────────────────────────────
--
-- Pushed into SQL rather than diffed client-side: `ledger_calls` grows without
-- bound and PostgREST truncates at ~1000 rows, so a client-side anti-join
-- would silently start missing calls (see CLAUDE.md). Callers read this view
-- with an explicit limit and an `order`.
--
-- A phase is pending when it has never been claimed, or when a claim is stale:
-- the poster died mid-send (posted_at still null) more than ten minutes ago
-- and has not already burned five attempts. A permanently failing message
-- stops after those five so a malformed call cannot hold up the queue — the
-- attempts and the last error stay on the row to be looked at.

create or replace view ledger_telegram_pending
with (security_invoker = true) as
  select c.id                        as call_id,
         'publish'::text             as phase,
         c.published_at              as event_at,
         coalesce(p.attempts, 0)     as attempts,
         to_jsonb(c)                 as call
    from ledger_calls c
    left join ledger_telegram_posts p
      on p.call_id = c.id and p.phase = 'publish'
   where p.call_id is null
      or (p.posted_at is null and p.attempts < 5 and p.claimed_at < now() - interval '10 minutes')
  union all
  select c.id,
         'resolution',
         c.resolved_at,
         coalesce(p.attempts, 0),
         to_jsonb(c)
    from ledger_calls c
    left join ledger_telegram_posts p
      on p.call_id = c.id and p.phase = 'resolution'
   where c.resolved_at is not null
     and (p.call_id is null
          or (p.posted_at is null and p.attempts < 5 and p.claimed_at < now() - interval '10 minutes'));

comment on view ledger_telegram_pending is
  'Ledger calls whose publish or resolution announcement has not been posted yet, oldest event first. Read with an explicit limit.';

-- ── Grants: internal bookkeeping, service role only ─────────────────────────
--
-- RLS on with no policy is deliberate, and the linter's INFO notice about it
-- is the intended state: nothing outside the service role has any business
-- reading the mirror's bookkeeping. The Ledger itself stays publicly readable.

alter table ledger_telegram_posts enable row level security;

revoke all on ledger_telegram_posts from anon, authenticated;
grant select, insert, update on ledger_telegram_posts to service_role;

revoke all on ledger_telegram_pending from anon, authenticated;
grant select on ledger_telegram_pending to service_role;
