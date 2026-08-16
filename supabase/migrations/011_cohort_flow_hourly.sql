-- Precomputed hourly cohort flow — the replay engine's signal source.
--
-- Why this exists (same reason as migration 009's materialized view, measured
-- again here): aggregating fills live at capture volume does not fit inside
-- the API statement timeout. One day of BTC fills is ~30k rows and took 11s to
-- scan cold; a 60-day replay window needs 60 of those. PostgREST's roles cap
-- statements at 3s (anon) / 8s (authenticated + authenticator, which
-- service_role inherits), so verify_cohort_flow_hourly() from migration 010 is
-- only usable for narrow wallet-filtered slices.
--
-- So the aggregate is maintained incrementally by pg_cron and read as a small
-- indexed table. Contents are byte-identical in meaning to
-- verify_cohort_flow_hourly(): same direction semantics as pulse_24h, same
-- capture_gaps exclusion (a wallet+coin pair whose pre-capture history is
-- truncated has an untrustworthy start_position, so it cannot be used to
-- classify new positions).

create table if not exists cohort_flow_hourly (
  coin         text        not null,
  bucket       timestamptz not null,
  fills        bigint      not null,
  wallets      bigint      not null,
  notional     double precision not null,
  net_flow     double precision not null,
  new_longs    bigint      not null,
  new_shorts   bigint      not null,
  new_notional double precision not null,
  add_notional double precision not null,
  computed_at  timestamptz not null default now(),
  primary key (coin, bucket)
);

create index if not exists idx_cohort_flow_hourly_bucket on cohort_flow_hourly (bucket);

-- Rebuild a time slice. Idempotent: the slice is deleted and recomputed, so a
-- re-run after late-arriving fills (the REST sweep heals WS outages hours
-- later) converges rather than double-counting.
create or replace function cohort_flow_rebuild(p_from timestamptz, p_to timestamptz)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
  lo timestamptz := date_trunc('hour', p_from);
  hi timestamptz := date_trunc('hour', p_to) + interval '1 hour';
begin
  delete from cohort_flow_hourly where bucket >= lo and bucket < hi;

  with rows as (
    select
      f.asset as coin,
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
    where f.timestamp >= lo
      and f.timestamp <  hi
      and f.tid is not null
      and not exists (
        select 1 from capture_gaps g
         where g.wallet_address = f.wallet_address and g.coin = f.asset
      )
  )
  insert into cohort_flow_hourly (
    coin, bucket, fills, wallets, notional, net_flow,
    new_longs, new_shorts, new_notional, add_notional, computed_at
  )
  select
    coin,
    bucket,
    count(*),
    count(distinct wallet_address),
    coalesce(sum(notional), 0),
    coalesce(sum(notional * dir_sign), 0),
    count(*) filter (where is_new and dir_sign = 1),
    count(*) filter (where is_new and dir_sign = -1),
    coalesce(sum(notional) filter (where is_new), 0),
    coalesce(sum(notional) filter (where is_add), 0),
    now()
  from rows
  group by coin, bucket;

  get diagnostics n = row_count;
  return n;
end $$;

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Aggregating fills is I/O bound on this instance (measured: ~90s for 48h
-- across all coins; a single hour of BTC took 26s cold) and pg_cron inherits a
-- 2 minute statement timeout, so no single statement can rebuild history. The
-- backfill therefore walks backwards a day at a time, and several disjoint
-- slices run in parallel — the workload is read-latency bound, so parallel
-- slices convert waiting into throughput.
--
-- Progress is tracked explicitly rather than inferred from min(bucket): an
-- hour with no captured fills legitimately produces no rows, and inferring
-- progress from row presence would make such a chunk repeat forever. A step
-- that times out rolls back whole (rebuild + progress update are one
-- transaction) and simply retries on the next tick.

create table if not exists cohort_flow_backfill_state (
  slice       text primary key,
  target_from timestamptz not null,
  filled_from timestamptz not null,   -- everything at or after this is built
  updated_at  timestamptz not null default now()
);

-- p_step is per-slice because fill volume is not uniform: a day of recent
-- history does not fit in the timeout, an older day does.
create or replace function cohort_flow_backfill_slice(
  p_slice text, p_from timestamptz, p_to timestamptz, p_step interval default interval '1 day')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  hi timestamptz;
  lo timestamptz;
  n  bigint;
begin
  insert into cohort_flow_backfill_state (slice, target_from, filled_from)
  values (p_slice, date_trunc('hour', p_from), date_trunc('hour', p_to))
  on conflict (slice) do nothing;

  select filled_from into hi from cohort_flow_backfill_state where slice = p_slice;
  if hi <= date_trunc('hour', p_from) then
    return 'complete';
  end if;

  lo := greatest(hi - p_step, date_trunc('hour', p_from));
  n := cohort_flow_rebuild(lo, hi - interval '1 hour');
  update cohort_flow_backfill_state
     set filled_from = lo, updated_at = now()
   where slice = p_slice;
  return format('%s: filled %s .. %s -> %s rows', p_slice, lo, hi, n);
end $$;

-- Recent hours are rebuilt every 15 minutes: the capture daemon's REST sweep
-- backfills fills the WebSocket missed, so the last few hours keep changing
-- after the fact.
select cron.schedule(
  'rebuild-cohort-flow-hourly',
  '*/15 * * * *',
  $$select cohort_flow_rebuild(now() - interval '6 hours', now())$$
);

-- Historical backfill. The bounds are dated literals on purpose: a relative
-- bound would drift every tick and never converge. Once the range is built the
-- job returns 'complete' and costs nothing, so leaving it scheduled is cheap.
--
-- ONE job, every 10 minutes, six hours at a time. This pacing is deliberate
-- and was learned the hard way: four slices every two minutes saturated the
-- instance's IO so completely that PostgREST stopped answering and the capture
-- daemon's writes failed for the better part of an hour. This table shares a
-- small instance with a continuously-writing capture daemon — backfill it
-- slowly, and widen the step only after watching cron.job_run_details and the
-- daemon's heartbeats stay healthy.
select cron.schedule(
  'cohort-backfill-history',
  '*/10 * * * *',
  $$select cohort_flow_backfill_slice('history', '2026-06-16T00:00:00Z', '2026-08-16T00:00:00Z', interval '6 hours')$$
);

-- Reads: public, and paged like everything else (CLAUDE.md).
alter table cohort_flow_hourly enable row level security;
drop policy if exists "public read" on cohort_flow_hourly;
create policy "public read" on cohort_flow_hourly for select using (true);

revoke all on cohort_flow_hourly from anon, authenticated;
grant select on cohort_flow_hourly to anon, authenticated;
grant select, insert, update, delete on cohort_flow_hourly to service_role;

revoke all on function cohort_flow_rebuild(timestamptz, timestamptz) from public;
grant execute on function cohort_flow_rebuild(timestamptz, timestamptz) to service_role;
revoke all on function cohort_flow_backfill_slice(text, timestamptz, timestamptz, interval) from public;
grant execute on function cohort_flow_backfill_slice(text, timestamptz, timestamptz, interval) to service_role;
grant select on cohort_flow_backfill_state to anon, authenticated;
