-- Concentration inputs for the cohort_signal publishing floors.
--
-- Why this exists: HYPE read -62.2% skew on $3.9M notional across 7 wallets
-- and cleared every floor the Ledger had (skew, notional, wallet count) — but
-- a single wallet held roughly two thirds of the short opens. That is one
-- trader's position wearing a cohort's clothes. Skew says how lopsided the
-- book is; nothing said how few hands made it that way.
--
-- pulse_24h is rebuilt here with the per-wallet shape needed to answer that,
-- REDUCED TO AGGREGATES BEFORE IT LEAVES THE VIEW. The original view's contract
-- holds unchanged: no individual wallet is identifiable. A share of a total and
-- a count of participants are aggregates; an address is not, and none is
-- selected, stored or exposed. The largest single contribution is carried as a
-- notional, never as a wallet.
--
-- Cost: the per-wallet rollup is a second grouping over the SAME 48-hour slice
-- of fills the view already scans — bounded by the trailing window, not by
-- total capture volume. This is deliberately unlike the cohort_flow_hourly
-- rebuild that saturated the instance (CLAUDE.md, "Operational notes"): that one
-- grew with every fill ever captured; this one does not.
--
-- Measured before applying: the per-wallet rollup runs in ~964 ms over 786,696
-- fills (193 coins, 432 coin+wallet groups), against a 30-minute refresh. The
-- refresh schedule is NOT touched. Whatever cadence 'refresh-pulse-24h'
-- currently runs at is the cadence it keeps — this migration replaces the view
-- definition only. (The live view reports computed_at on :00/:30, i.e. the
-- 30-minute floor, not the */5 written in 009_pulse.sql.)
--
-- /api/pulse fails CLOSED against this: until this migration is applied the
-- concentration columns are absent, the API reports concentration as null, and
-- cohortSignalCall() refuses to publish rather than treating "not measured" as
-- "not concentrated". Missing data is never zero.

drop materialized view if exists pulse_24h;

create materialized view pulse_24h as
with recent as (
  select
    asset,
    size * price as notional,
    wallet_address,
    case
      when trade_type in ('Open Long', 'Close Short', 'Short > Long') then 1
      when trade_type in ('Open Short', 'Close Long', 'Long > Short') then -1
      else 0
    end as dir_sign,
    (trade_type like 'Open %' and abs(coalesce(start_position, 1)) < 1e-9) as is_new,
    (trade_type like 'Open %' and abs(coalesce(start_position, 0)) >= 1e-9) as is_add,
    (timestamp > now() - interval '24 hours') as in_current
  from fills
  where timestamp > now() - interval '48 hours'
    and tid is not null              -- captured rows only (have trade_type + start_position)
),
-- One row per (coin, wallet): the wallet's gross notional in each direction
-- over the current 24h. This is the only place wallet_address is grouped on,
-- and nothing downstream selects it.
per_wallet as (
  select
    asset,
    wallet_address,
    coalesce(sum(notional) filter (where in_current and dir_sign = 1), 0)  as long_notional,
    coalesce(sum(notional) filter (where in_current and dir_sign = -1), 0) as short_notional
  from recent
  group by asset, wallet_address
),
-- Collapse to per-coin aggregates. max() is the largest single wallet's
-- contribution; the wallet it belongs to is discarded here and never leaves.
concentration as (
  select
    asset,
    coalesce(sum(long_notional), 0)  as long_notional_24h,
    coalesce(sum(short_notional), 0) as short_notional_24h,
    count(*) filter (where long_notional > 0)  as long_wallets_24h,
    count(*) filter (where short_notional > 0) as short_wallets_24h,
    coalesce(max(long_notional), 0)  as top_long_wallet_notional_24h,
    coalesce(max(short_notional), 0) as top_short_wallet_notional_24h
  from per_wallet
  group by asset
),
base as (
  select
    asset,
    coalesce(sum(notional)            filter (where in_current), 0) as notional_24h,
    coalesce(sum(notional * dir_sign) filter (where in_current), 0) as net_flow_24h,
    count(*) filter (where in_current and is_new and dir_sign = 1)  as new_longs_24h,
    count(*) filter (where in_current and is_new and dir_sign = -1) as new_shorts_24h,
    coalesce(sum(notional) filter (where in_current and is_new), 0) as new_notional_24h,
    coalesce(sum(notional) filter (where in_current and is_add), 0) as add_notional_24h,
    count(distinct wallet_address) filter (where in_current) as wallets_24h,
    coalesce(sum(notional)            filter (where not in_current), 0) as notional_prev,
    coalesce(sum(notional * dir_sign) filter (where not in_current), 0) as net_flow_prev
  from recent
  group by asset
)
select
  base.asset as coin,
  base.notional_24h,
  base.net_flow_24h,
  base.new_longs_24h,
  base.new_shorts_24h,
  base.new_notional_24h,
  base.add_notional_24h,
  base.wallets_24h,
  base.notional_prev,
  base.net_flow_prev,
  concentration.long_notional_24h,
  concentration.short_notional_24h,
  concentration.long_wallets_24h,
  concentration.short_wallets_24h,
  concentration.top_long_wallet_notional_24h,
  concentration.top_short_wallet_notional_24h,
  now() as computed_at
from base
join concentration on concentration.asset = base.asset;

-- Required by `refresh materialized view concurrently`.
create unique index if not exists idx_pulse_24h_coin on pulse_24h (coin);

-- Dropping a matview drops its ACL with it. The live view carried
-- arwdDxtm for anon, authenticated and service_role; without this the public
-- /api/pulse read starts failing the moment this migration lands, which is a
-- silent outage of the page rather than a visible migration error.
grant all on pulse_24h to anon, authenticated, service_role;

-- The API reads this view through PostgREST.
notify pgrst, 'reload schema';
