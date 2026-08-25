-- 010: Verification surface fixes
--
-- 1. verify_tape_prices: the price-tape reader the verification surface was
--    missing. Returns the REAL 1-minute candle rows captured in candles_1m
--    for a coin and window. It never fabricates rows for minutes that were
--    not captured: a missing minute is absent from the result, and consumers
--    must treat it as missing data, never as a zero price.
--
-- 2. cohort_flow_series: gap-aware contiguous hourly series over
--    cohort_flow_hourly. Invariant: missing data is never zero.
--    - covered = true  -> capture recorded fills in that hour (for some coin);
--      a coin with no row in a covered hour genuinely had no eligible fills,
--      so its values are true zeros.
--    - covered = false -> no capture data exists for that hour at all; every
--      value is NULL. A rule evaluator (e.g. cross_above on net_flow) must
--      not fire on NULL buckets.
--
-- 3. Drop cohort_flow_backfill_step: stateless predecessor of
--    cohort_flow_backfill_slice, keyed on min(bucket), which breaks once the
--    series has more than one filled region. Superseded and unreferenced.

create or replace function public.verify_tape_prices(
  p_coin   text,
  p_from   timestamptz,
  p_to     timestamptz,
  p_limit  int default 1000,
  p_offset int default 0
) returns table (
  t timestamptz,
  o double precision,
  h double precision,
  l double precision,
  c double precision,
  v double precision
)
language sql
stable parallel safe
set search_path to 'public'
as $$
  select t, o, h, l, c, v
    from candles_1m
   where coin = p_coin
     and t >= p_from
     and t <  p_to
   order by t
   limit  greatest(p_limit, 0)
  offset greatest(p_offset, 0)
$$;

comment on function public.verify_tape_prices(text, timestamptz, timestamptz, int, int) is
  'Real captured 1m price tape for a coin/window. Missing minutes are absent, never synthesized.';

create or replace function public.cohort_flow_series(
  p_coin   text,
  p_from   timestamptz,
  p_to     timestamptz,
  p_limit  int default 1000,
  p_offset int default 0
) returns table (
  bucket       timestamptz,
  covered      boolean,
  fills        bigint,
  wallets      bigint,
  notional     double precision,
  net_flow     double precision,
  new_longs    bigint,
  new_shorts   bigint,
  new_notional double precision,
  add_notional double precision
)
language sql
stable parallel safe
set search_path to 'public'
as $$
  with grid as (
    select generate_series(
             date_trunc('hour', p_from),
             date_trunc('hour', p_to) - interval '1 hour',
             interval '1 hour'
           ) as bucket
  ),
  coverage as (
    select distinct h.bucket
      from cohort_flow_hourly h
     where h.bucket >= date_trunc('hour', p_from)
       and h.bucket <  date_trunc('hour', p_to)
  ),
  coin_rows as (
    select h.*
      from cohort_flow_hourly h
     where h.coin = p_coin
       and h.bucket >= date_trunc('hour', p_from)
       and h.bucket <  date_trunc('hour', p_to)
  )
  select
    g.bucket,
    (cov.bucket is not null) as covered,
    case when cov.bucket is null then null else coalesce(c.fills, 0)        end as fills,
    case when cov.bucket is null then null else coalesce(c.wallets, 0)      end as wallets,
    case when cov.bucket is null then null else coalesce(c.notional, 0)     end as notional,
    case when cov.bucket is null then null else coalesce(c.net_flow, 0)     end as net_flow,
    case when cov.bucket is null then null else coalesce(c.new_longs, 0)    end as new_longs,
    case when cov.bucket is null then null else coalesce(c.new_shorts, 0)   end as new_shorts,
    case when cov.bucket is null then null else coalesce(c.new_notional, 0) end as new_notional,
    case when cov.bucket is null then null else coalesce(c.add_notional, 0) end as add_notional
  from grid g
  left join coverage cov on cov.bucket = g.bucket
  left join coin_rows c  on c.bucket   = g.bucket
  order by g.bucket
  limit  greatest(p_limit, 0)
  offset greatest(p_offset, 0)
$$;

comment on function public.cohort_flow_series(text, timestamptz, timestamptz, int, int) is
  'Contiguous hourly cohort-flow series. covered=false hours return NULL values: missing data is never zero.';

drop function if exists public.cohort_flow_backfill_step(timestamptz);
