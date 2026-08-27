-- Replay v2.2: wallet-indexed fills readers.
--
-- The app's fills reads through PostgREST are parameterized, and Postgres'
-- generic plans for "wallet_address = $1 AND asset = $2 ORDER BY timestamp"
-- can pick the (asset, timestamp) index — walking the ASSET's rows across
-- every wallet and filtering. For a popular asset that is millions of rows,
-- and it hit statement_timeout in the wild (57014 on a wallet with two BTC
-- fills while its SOL reads flew). The failure was nondeterministic because
-- the generic-plan flip is per connection.
--
-- These readers make the plan structural: the coin filter is written as
-- (p_coin = '' or asset = p_coin), which no asset index can serve under any
-- plan mode, so every plan drives from the wallet index. Semantics are
-- identical to the raw queries they replace ('' = all coins), including the
-- capture-daemon-only rule (tid is not null) and the (timestamp, tid) total
-- order that keeps concurrent pages from overlapping at equal timestamps.
--
-- All results are bounded: pages at 1000 rows, scalars are scalars.

create or replace function replay_wallet_fills_asc(
  p_wallet text,
  p_coin   text,
  p_limit  int,
  p_offset int
) returns table (
  asset          text,
  side           text,
  size           double precision,
  price          double precision,
  fee_usd        double precision,
  realized_pnl   double precision,
  trade_type     text,
  "timestamp"    timestamptz,
  tid            bigint,
  start_position double precision
)
language sql
stable
as $$
  select asset, side, size, price, fee_usd, realized_pnl, trade_type,
         "timestamp", tid, start_position
  from fills
  where wallet_address = lower(p_wallet)
    and tid is not null
    and (p_coin = '' or asset = p_coin)
  order by "timestamp" asc, tid asc
  limit least(greatest(p_limit, 0), 1000)
  offset greatest(p_offset, 0)
$$;

create or replace function replay_wallet_fills_desc(
  p_wallet text,
  p_coin   text,
  p_limit  int,
  p_offset int
) returns table (
  asset          text,
  side           text,
  size           double precision,
  price          double precision,
  fee_usd        double precision,
  realized_pnl   double precision,
  trade_type     text,
  "timestamp"    timestamptz,
  tid            bigint,
  start_position double precision
)
language sql
stable
as $$
  select asset, side, size, price, fee_usd, realized_pnl, trade_type,
         "timestamp", tid, start_position
  from fills
  where wallet_address = lower(p_wallet)
    and tid is not null
    and (p_coin = '' or asset = p_coin)
  order by "timestamp" desc, tid desc
  limit least(greatest(p_limit, 0), 1000)
  offset greatest(p_offset, 0)
$$;

-- Fill count in scope; p_since narrows to fills strictly after an instant
-- (the doc route's fills-behind check). Null p_since = all covered history.
create or replace function replay_wallet_fill_count(
  p_wallet text,
  p_coin   text,
  p_since  timestamptz default null
) returns bigint
language sql
stable
as $$
  select count(*)
  from fills
  where wallet_address = lower(p_wallet)
    and tid is not null
    and (p_coin = '' or asset = p_coin)
    and (p_since is null or "timestamp" > p_since)
$$;

-- Newest captured fill in scope — the doc route's freshness anchor.
create or replace function replay_wallet_newest_fill(
  p_wallet text,
  p_coin   text
) returns table (tid bigint, "timestamp" timestamptz)
language sql
stable
as $$
  select tid, "timestamp"
  from fills
  where wallet_address = lower(p_wallet)
    and tid is not null
    and (p_coin = '' or asset = p_coin)
  order by "timestamp" desc, tid desc
  limit 1
$$;

notify pgrst, 'reload schema';
