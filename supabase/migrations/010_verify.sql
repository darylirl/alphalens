-- Verification service: job queue, immutable results, replay data access
-- (Prompt C — replay engine becomes a service).
--
-- Design notes that matter:
--   * verification_results is APPEND-ONLY at the database level. Grants are
--     revoked and a trigger raises on UPDATE/DELETE, so "we edited a result
--     after the fact" is not a thing that can happen, by app bug or by hand.
--   * A result that is missing its spec, its frictions, or its verdict cannot
--     be inserted: CHECK constraints reject it. The friction floors (60s /
--     5bps / 0.045%) are enforced here too, not only in the service — the
--     database is the last line where an under-frictioned number could sneak
--     in.
--   * Job claiming goes through an RPC because PostgREST cannot express
--     FOR UPDATE SKIP LOCKED. The lock semantics are the point: N workers may
--     poll concurrently and each claims a distinct job or nothing.

-- ── Queue ───────────────────────────────────────────────────────────────────

create table if not exists verification_jobs (
  id           bigserial primary key,
  spec         jsonb       not null,
  spec_hash    text        not null,
  status       text        not null default 'queued'
                 check (status in ('queued', 'running', 'done', 'failed')),
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  error        text,
  requested_by text,
  worker       text
);

-- The queue poll: queued jobs oldest first.
create index if not exists idx_verification_jobs_queue
  on verification_jobs (status, created_at)
  where status in ('queued', 'running');
create index if not exists idx_verification_jobs_spec_hash
  on verification_jobs (spec_hash);

-- ── Result shape guards (CHECK cannot contain subqueries; these can) ─────────

create or replace function verify_spec_ok(s jsonb) returns boolean
language sql immutable parallel safe as $$
  select jsonb_typeof(s) = 'object'
     and s ? 'spec_version'
     and s ? 'hypothesis_text'
     and s ? 'universe'
     and s ? 'entry'
     and s ? 'exit'
     and s ? 'sizing'
     and s ? 'window'
     and s ? 'frictions'
     and s ? 'kill_criteria'
     and jsonb_typeof(s->'kill_criteria') = 'array'
     and jsonb_array_length(s->'kill_criteria') >= 1
$$;

-- The friction floors, in the database. Higher is allowed; lower is rejected.
-- taker_fee_pct is a PERCENT per side (0.045 = 0.045% = 4.5 bps).
create or replace function verify_frictions_ok(f jsonb) returns boolean
language sql immutable parallel safe as $$
  select jsonb_typeof(f) = 'object'
     and (f->>'delay_s')        ~ '^[0-9]+(\.[0-9]+)?$'
     and (f->>'slippage_bps')   ~ '^[0-9]+(\.[0-9]+)?$'
     and (f->>'taker_fee_pct')  ~ '^[0-9]+(\.[0-9]+)?$'
     and (f->>'delay_s')::numeric       >= 60
     and (f->>'slippage_bps')::numeric  >= 5
     and (f->>'taker_fee_pct')::numeric >= 0.045
$$;

-- Every pre-registered kill criterion must be evaluated, each with an explicit
-- boolean pass. An empty criteria array is not a verdict.
create or replace function verify_verdict_ok(v jsonb) returns boolean
language sql immutable parallel safe as $$
  select jsonb_typeof(v) = 'object'
     and v ? 'overall'
     and (v->>'overall') in ('pass', 'killed')
     and jsonb_typeof(v->'criteria') = 'array'
     and jsonb_array_length(v->'criteria') >= 1
     and not exists (
       select 1 from jsonb_array_elements(v->'criteria') c
        where not (c ? 'id' and c ? 'pass' and jsonb_typeof(c->'pass') = 'boolean')
     )
$$;

create or replace function verify_metrics_ok(m jsonb) returns boolean
language sql immutable parallel safe as $$
  select jsonb_typeof(m) = 'object'
     and m ? 'net_pnl_usd'
     and m ? 'gross_pnl_usd'
     and m ? 'fees_usd'
     and m ? 'win_rate'
     and m ? 'profit_factor'
     and m ? 'max_drawdown_usd'
     and m ? 'max_drawdown_pct'
     and m ? 'trade_count'
     and m ? 'avg_hold_s'
     and jsonb_typeof(m->'monthly') = 'array'
$$;

create or replace function verify_coverage_ok(d jsonb) returns boolean
language sql immutable parallel safe as $$
  select jsonb_typeof(d) = 'object'
     and d ? 'window_requested'
     and d ? 'window_served'
     and jsonb_typeof(d->'granularity_mix') = 'object'
     and jsonb_typeof(d->'source_mix')      = 'object'
     and jsonb_typeof(d->'excluded_pairs')  = 'array'
$$;

-- ── Results (append-only) ───────────────────────────────────────────────────

create table if not exists verification_results (
  id             bigserial primary key,
  job_id         bigint      not null references verification_jobs (id),
  spec           jsonb       not null,
  spec_hash      text        not null,
  trades_csv_path text,                    -- Supabase Storage object path
  trade_count    int         not null,
  metrics        jsonb       not null,
  verdict        jsonb       not null,
  data_coverage  jsonb       not null,
  engine_version text        not null,
  created_at     timestamptz not null default now(),

  constraint verification_results_spec_shape      check (verify_spec_ok(spec)),
  constraint verification_results_frictions_floor check (verify_frictions_ok(spec->'frictions')),
  constraint verification_results_verdict_shape   check (verify_verdict_ok(verdict)),
  constraint verification_results_metrics_shape   check (verify_metrics_ok(metrics)),
  constraint verification_results_coverage_shape  check (verify_coverage_ok(data_coverage)),
  constraint verification_results_engine_version  check (length(engine_version) > 0),
  constraint verification_results_spec_hash       check (spec_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists idx_verification_results_job on verification_results (job_id);
create index if not exists idx_verification_results_hash on verification_results (spec_hash, created_at desc);

-- Append-only, enforced by the database rather than by convention.
create or replace function verification_results_append_only() returns trigger
language plpgsql as $$
begin
  raise exception
    'verification_results is append-only: % is not permitted. Re-run the spec to produce a new result row.',
    tg_op;
end $$;

drop trigger if exists trg_verification_results_append_only on verification_results;
create trigger trg_verification_results_append_only
  before update or delete on verification_results
  for each row execute function verification_results_append_only();

-- ── Job claiming: FOR UPDATE SKIP LOCKED behind an RPC ──────────────────────

create or replace function claim_verification_job(p_worker text default null)
returns setof verification_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed verification_jobs;
begin
  select * into claimed
    from verification_jobs
   where status = 'queued'
   order by created_at
   for update skip locked
   limit 1;

  if not found then
    return;
  end if;

  update verification_jobs
     set status = 'running',
         started_at = now(),
         worker = coalesce(p_worker, worker)
   where id = claimed.id
  returning * into claimed;

  return next claimed;
end $$;

-- ── Cohort positioning series (pulse_24h shapes, evaluated historically) ────
--
-- pulse_24h only covers the trailing 24-48h; a replay needs the same shapes
-- over the whole window. Direction semantics are copied verbatim from
-- migration 009 so a rule that fires on the live pulse fires identically here.
--
-- Wallet+coin pairs in capture_gaps are EXCLUDED: their pre-capture history is
-- incomplete, so their start_position cannot be trusted to classify a fill as
-- opening a new position. Excluding them is the anti-fabrication rule applied
-- to the signal side.
--
-- Bounded by construction: an explicit time range plus limit/offset. Callers
-- MUST page (see CLAUDE.md — PostgREST truncates at ~1000 rows silently).
create or replace function verify_cohort_flow_hourly(
  p_coin    text,
  p_from    timestamptz,
  p_to      timestamptz,
  p_wallets text[] default null,
  p_limit   int     default 1000,
  p_offset  int     default 0
)
returns table (
  bucket        timestamptz,
  fills         bigint,
  wallets       bigint,
  notional      double precision,
  net_flow      double precision,
  new_longs     bigint,
  new_shorts    bigint,
  new_notional  double precision,
  add_notional  double precision
)
language sql
stable
parallel safe
set search_path = public
as $$
  with rows as (
    select
      date_trunc('hour', f.timestamp) as bucket,
      f.wallet_address,
      f.size * f.price as notional,
      case
        when f.trade_type in ('Open Long', 'Close Short', 'Short > Long') then 1
        when f.trade_type in ('Open Short', 'Close Long', 'Long > Short') then -1
        else 0
      end as dir_sign,
      (f.trade_type like 'Open %' and abs(coalesce(f.start_position, 1)) < 1e-9) as is_new,
      (f.trade_type like 'Open %' and abs(coalesce(f.start_position, 0)) >= 1e-9) as is_add
    from fills f
    where f.asset = p_coin
      and f.timestamp >= p_from
      and f.timestamp <  p_to
      and f.tid is not null                     -- captured rows only
      and (p_wallets is null or f.wallet_address = any (p_wallets))
      and not exists (
        select 1 from capture_gaps g
         where g.wallet_address = f.wallet_address and g.coin = p_coin
      )
  )
  select
    bucket,
    count(*)                                                  as fills,
    count(distinct wallet_address)                            as wallets,
    coalesce(sum(notional), 0)                                as notional,
    coalesce(sum(notional * dir_sign), 0)                     as net_flow,
    count(*) filter (where is_new and dir_sign = 1)           as new_longs,
    count(*) filter (where is_new and dir_sign = -1)          as new_shorts,
    coalesce(sum(notional) filter (where is_new), 0)          as new_notional,
    coalesce(sum(notional) filter (where is_add), 0)          as add_notional
  from rows
  group by bucket
  order by bucket
  limit  greatest(p_limit, 0)
  offset greatest(p_offset, 0)
$$;

-- The cohort series scans fills by (asset, timestamp); without this index the
-- planner falls back to the timestamp-only index and re-filters millions of
-- rows per coin.
create index if not exists idx_fills_asset_ts on fills (asset, "timestamp");

-- ── Storage bucket for per-trade CSVs ───────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('verification-results', 'verification-results', false)
on conflict (id) do nothing;

-- ── Grants / RLS ────────────────────────────────────────────────────────────
-- Reads are public (the app reads job status with whatever key it holds);
-- writes require the service-role key that only the server and the worker
-- hold. UPDATE/DELETE on results is revoked from EVERY role — the append-only
-- trigger is the backstop, this is the front door.

alter table verification_jobs    enable row level security;
alter table verification_results enable row level security;

drop policy if exists "public read" on verification_jobs;
create policy "public read" on verification_jobs for select using (true);
drop policy if exists "public read" on verification_results;
create policy "public read" on verification_results for select using (true);

revoke all on verification_jobs    from anon, authenticated;
revoke all on verification_results from anon, authenticated;
grant select on verification_jobs    to anon, authenticated;
grant select on verification_results to anon, authenticated;

revoke update, delete, truncate on verification_results from anon, authenticated, service_role;
grant insert, select on verification_results to service_role;
grant select, insert, update on verification_jobs to service_role;

grant usage on sequence verification_jobs_id_seq    to service_role;
grant usage on sequence verification_results_id_seq to service_role;

revoke all on function claim_verification_job(text) from public;
grant execute on function claim_verification_job(text) to service_role;
grant execute on function verify_cohort_flow_hourly(text, timestamptz, timestamptz, text[], int, int)
  to anon, authenticated, service_role;
