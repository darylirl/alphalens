-- Coverage-aware replay support, and a worker-paced backfill.
--
-- Three things live here:
--
--   1. cohort_flow_coverage_hours() — which hours the hourly aggregate was
--      actually BUILT for, independent of any one coin's values. This is the
--      ground truth behind "missing data is never zero" (CLAUDE.md rule 3):
--      the build is global per hour, so an hour present for any coin was
--      computed for every coin, and a coin absent from a covered hour
--      genuinely did not trade. Without this, a replay cannot tell an outage
--      from a quiet market — and a partially-built aggregate replays its own
--      gaps as "cohort flow went flat", which manufactures entry signals.
--
--   2. verify_tape_prices_at() — the batched tape lookup for the fill-price
--      ladder. NAME NOTE: a different, unrelated verify_tape_prices(p_coin,
--      p_from, p_to, p_limit, p_offset) already exists in this database,
--      created outside this migration series. Rather than overload a name that
--      already means something else, this one is named _at. Do not merge them
--      without checking what calls the other.
--
--   3. A lease on cohort_flow_backfill_state, so the backfill can run as a
--      worker-paced job with an overlap guard. Heavy aggregation is
--      deliberately NOT scheduled in pg_cron: four parallel cron slices at two
--      minute pacing once saturated this instance's IO to the point where
--      PostgREST stopped answering and the capture daemon's writes failed for
--      the better part of an hour. Rebuilds are driven by verify-service's
--      backfill worker instead, which paces itself and holds a lease.

-- ── 1. Coverage ─────────────────────────────────────────────────────────────
create or replace function cohort_flow_coverage_hours(
  p_from   timestamptz,
  p_to     timestamptz,
  p_limit  int default 1000,
  p_offset int default 0
)
returns table (bucket timestamptz, coins bigint)
language sql
stable
parallel safe
set search_path = public
as $$
  select bucket, count(*) as coins
    from cohort_flow_hourly
   where bucket >= p_from and bucket < p_to
   group by bucket
   order by bucket
   limit  greatest(p_limit, 0)
  offset greatest(p_offset, 0)
$$;

grant execute on function cohort_flow_coverage_hours(timestamptz, timestamptz, int, int)
  to anon, authenticated, service_role;

-- ── 2. Batched tape lookup ──────────────────────────────────────────────────
create or replace function verify_tape_prices_at(
  p_coin    text,
  p_targets timestamptz[],
  p_search  interval default interval '15 minutes'
)
returns table (target timestamptz, ts timestamptz, price double precision)
language sql
stable
parallel safe
set search_path = public
as $$
  select t.target, hit.timestamp, hit.price
  from unnest(p_targets) as t(target)
  left join lateral (
    select f.timestamp, f.price
      from fills f
     where f.asset = p_coin
       and f.timestamp >= t.target
       and f.timestamp <  t.target + p_search
       and f.tid is not null
     order by f.timestamp asc
     limit 1
  ) hit on true
$$;

grant execute on function verify_tape_prices_at(text, timestamptz[], interval)
  to anon, authenticated, service_role;

-- ── 3. Backfill lease (overlap guard) ───────────────────────────────────────
alter table cohort_flow_backfill_state add column if not exists leased_until timestamptz;
alter table cohort_flow_backfill_state add column if not exists leased_by text;

-- Atomically claim (or renew) the right to advance one slice. Two workers
-- racing on the same slice cannot both win: the UPDATE's WHERE clause is the
-- guard, evaluated under row lock.
create or replace function cohort_flow_backfill_claim(
  p_slice text,
  p_from  timestamptz,
  p_to    timestamptz,
  p_by    text,
  p_ttl   interval default interval '10 minutes'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  got boolean;
begin
  insert into cohort_flow_backfill_state (slice, target_from, filled_from)
  values (p_slice, date_trunc('hour', p_from), date_trunc('hour', p_to))
  on conflict (slice) do nothing;

  update cohort_flow_backfill_state
     set leased_until = now() + p_ttl, leased_by = p_by
   where slice = p_slice
     and (leased_until is null or leased_until < now())
  returning true into got;

  return coalesce(got, false);
end $$;

create or replace function cohort_flow_backfill_release(p_slice text)
returns void
language sql
security definer
set search_path = public
as $$
  update cohort_flow_backfill_state set leased_until = null where slice = p_slice;
$$;

revoke all on function cohort_flow_backfill_claim(text, timestamptz, timestamptz, text, interval) from public;
revoke all on function cohort_flow_backfill_release(text) from public;
grant execute on function cohort_flow_backfill_claim(text, timestamptz, timestamptz, text, interval)
  to service_role;
grant execute on function cohort_flow_backfill_release(text) to service_role;
