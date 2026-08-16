-- Aggregate positioning for the public /pulse page (Prompt B).
--
-- Computed from CAPTURED fills (the deployed daemon writes continuously with
-- tid + start_position); no live Hyperliquid calls on the read path. A
-- materialized view refreshed by pg_cron every 5 minutes: live aggregation
-- at capture volume exceeds API statement timeouts (measured 11s+ for 7d),
-- and function-level SET cannot extend the outer statement's timer.
--
-- Direction semantics from the exchange-reported trade_type:
--   long-directed flow:  Open Long, Close Short, Short > Long
--   short-directed flow: Open Short, Close Long, Long > Short
-- New position = an Open* fill whose start_position is ~0 (position opened
-- from flat) — weighted separately from additions per the spec.
-- No individual wallet is identifiable: only aggregate counts and notionals.

create materialized view if not exists pulse_24h as
with recent as (
  select
    asset,
    size * price as notional,
    timestamp,
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
)
select
  asset as coin,
  -- current 24h
  coalesce(sum(notional)          filter (where in_current), 0) as notional_24h,
  coalesce(sum(notional * dir_sign) filter (where in_current), 0) as net_flow_24h,
  count(*)                        filter (where in_current and is_new and dir_sign = 1)  as new_longs_24h,
  count(*)                        filter (where in_current and is_new and dir_sign = -1) as new_shorts_24h,
  coalesce(sum(notional) filter (where in_current and is_new), 0) as new_notional_24h,
  coalesce(sum(notional) filter (where in_current and is_add), 0) as add_notional_24h,
  count(distinct wallet_address)  filter (where in_current) as wallets_24h,
  -- prior 24h (24-48h ago) for change-vs-prior
  coalesce(sum(notional)          filter (where not in_current), 0) as notional_prev,
  coalesce(sum(notional * dir_sign) filter (where not in_current), 0) as net_flow_prev,
  now() as computed_at
from recent
group by asset;

create unique index if not exists idx_pulse_24h_coin on pulse_24h (coin);

select cron.schedule(
  'refresh-pulse-24h',
  '*/5 * * * *',
  'refresh materialized view concurrently pulse_24h'
);
