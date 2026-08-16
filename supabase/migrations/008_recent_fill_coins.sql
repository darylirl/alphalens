-- Coin universe for the capture daemon's candle subscriptions.
--
-- The daemon previously fetched raw fill rows and distinct-counted client
-- side; PostgREST caps responses at ~1000 rows and, without an order clause,
-- returns an arbitrary slice — so the daemon saw only ~2 coins when the real
-- 7-day universe was 331. A plain view was tried first but the live aggregate
-- takes 11s+ at capture volume (the 7-day predicate matches nearly the whole
-- table), blowing the API statement timeout — hence a MATERIALIZED view,
-- refreshed by the daemon via the security-definer RPC below (runs as owner,
-- not subject to the anon role's statement timeout).

-- Useful independently: the original fills index leads with wallet_address,
-- so pure time-range scans had no index at all.
create index if not exists idx_fills_timestamp on fills (timestamp desc);

drop view if exists recent_fill_coins;

create materialized view if not exists recent_fill_coins as
  select asset as coin,
         count(*) as fills,
         max(timestamp) as latest
  from fills
  where timestamp > now() - interval '7 days'
  group by asset;

-- Unique index required for REFRESH ... CONCURRENTLY.
create unique index if not exists idx_recent_fill_coins_coin on recent_fill_coins (coin);

-- Refresh runs server-side via pg_cron every 30 minutes. An RPC-based
-- refresh was tried and CANNOT work through PostgREST: statement_timeout is
-- fixed when the outer statement starts, so a function-level SET can't
-- extend an already-running statement's timer, and the refresh exceeds the
-- API roles' timeouts at capture volume.
create extension if not exists pg_cron;
select cron.schedule(
  'refresh-recent-fill-coins',
  '*/30 * * * *',
  'refresh materialized view concurrently recent_fill_coins'
);
