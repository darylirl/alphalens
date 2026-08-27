-- Proven discontinuities in a wallet's captured fills, per coin.
--
-- The coin menu shows a date range and a realized-PnL total per coin. Both
-- read as claims about a continuous window, and for a wallet that fell out of
-- capture scope they are not: the fixture wallet
-- 0x020ca66c30bec2c4fe3861a94e4db4a498a35872 shows HYPE as
-- "2026-04-19 – 2026-08-24" across a 98-day hole. The menu is built from an
-- aggregate (migration 023) precisely so it does not page 20K fills, so the
-- gap detection has to be an aggregate too.
--
-- What makes a gap PROVEN: every fill carries `start_position`, the position
-- the wallet held before it. If the position implied by the last fill before
-- a quiet stretch disagrees with the start_position reported by the first
-- fill after it, fills happened in between that we never captured. Silence
-- alone proves nothing and is not reported here — a wallet is allowed to
-- stop trading, and drawing that as missing data is the same lie in reverse.
--
-- Positions are reconstructed per BURST, not per fill: fills sharing a
-- millisecond have no recoverable execution order (`tid` is not a sequence —
-- measured on the fixture: nine ETH fills at 2026-05-01T12:11:35.132 with
-- interleaved start positions), so a fill-by-fill difference reports a break
-- almost everywhere. A burst is anchored by its net direction — a net-buying
-- burst starts at the smallest reported start position, a net-selling burst
-- at the largest — and ends at that anchor plus the burst's net size. This
-- mirrors lib/wallet-data/gaps.ts exactly, thresholds included, so the SQL
-- path and the TypeScript path cannot disagree about what a gap is.
--
-- Bounded: one wallet's rows off the (wallet_address, timestamp) index, and
-- at most 200 gaps returned (largest unexplained move first). Only
-- capture-daemon rows count (tid is not null), the same rule every other
-- reader applies.

create or replace function replay_coin_gaps(p_wallet text)
returns table (
  coin              text,
  gap_from          timestamptz,
  gap_to            timestamptz,
  unexplained_coins double precision
)
language sql
stable
as $$
  with f as (
    select
      asset,
      "timestamp" as ts,
      start_position as s,
      (case when side = 'B' then size else -size end) as d
    from fills
    where wallet_address = lower(p_wallet)
      and tid is not null
      and start_position is not null
      and size is not null
  ),
  burst as (
    -- One row per (coin, exact timestamp): the position entering the burst
    -- and leaving it.
    select
      asset,
      ts,
      case when sum(d) >= 0 then min(s) else max(s) end as p_start,
      (case when sum(d) >= 0 then min(s) else max(s) end) + sum(d) as p_end
    from f
    group by asset, ts
  ),
  edge as (
    select
      asset,
      ts,
      p_start,
      lag(p_end) over (partition by asset order by ts) as prev_end,
      lag(ts) over (partition by asset order by ts) as prev_ts
    from burst
  )
  select
    asset::text as coin,
    prev_ts as gap_from,
    ts as gap_to,
    (p_start - prev_end)::double precision as unexplained_coins
  from edge
  where prev_end is not null
    -- GAP_MIN_MS: capture writes continuously, so a real hole is hours, not
    -- seconds. Below this a position discrepancy is burst-ordering noise.
    and ts - prev_ts >= interval '1 hour'
    -- The same relative tolerance the TypeScript detector applies, with the
    -- same absolute floor so a near-flat position cannot vanish it.
    and abs(p_start - prev_end) > greatest(abs(prev_end), 1) * 1e-4
  order by abs(p_start - prev_end) desc
  limit 200
$$;

notify pgrst, 'reload schema';
