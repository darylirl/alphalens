-- Famous Replays: a curated episode's fills, by WINDOW, in one round trip.
--
-- replay_wallet_fills_json (migration 020/021) serves a wallet+coin scope
-- capped at p_limit, and when the cap bites it keeps the most RECENT rows.
-- That is right for the replay's normal reads, whose subject IS the recent
-- history. It is wrong for a curated famous episode, whose subject is a
-- FIXED window in the past: as the wallet keeps trading, the pinned episode
-- drifts out of the most-recent slice and the read returns a scope that no
-- longer contains it. Not a hypothetical — measured 2026-08-27 on
-- 0x847bd1…d473, whose xyz:MU history held 14,025 fills with 11,594 of them
-- newer than the pinned episode's start, growing ~4,600/day against the
-- app's 20,000 cap. Within days the cap would have silently cut the episode
-- out of its own replay.
--
-- So: bound by TIME instead of by recency. The window is the caller's
-- (episode ± pad), the cap still applies as a backstop, and `total` is the
-- count within the window so truncation is DECLARED rather than inferred —
-- if it ever bites here, the honest answer is that the window itself is too
-- big, not that the episode ended early.
--
-- Everything else mirrors migration 021 deliberately, so the two readers
-- cannot drift: the same positional row shape, the same capture-daemon-only
-- rule (tid is not null), the same (timestamp, tid) total order, and the
-- same structurally-unservable-by-the-asset-index coin guard from migration
-- 019 — (p_coin = '' or asset = p_coin) — so every plan drives from the
-- wallet index and cannot pick (asset, timestamp) and time out.
--
-- Row shape (positional, matches the app's StoreFillRow):
--   [asset, side, size, price, fee_usd, realized_pnl, trade_type,
--    timestamp_ms, tid, start_position]

create or replace function replay_wallet_fills_window_json(
  p_wallet  text,
  p_coin    text,
  p_from_ms bigint,
  p_to_ms   bigint,
  p_limit   int
) returns jsonb
language sql
stable
as $$
  with bounded as (
    select least(greatest(p_limit, 0), 100000) as lim,
           to_timestamp(p_from_ms / 1000.0) as t_from,
           to_timestamp(p_to_ms   / 1000.0) as t_to
  ),
  scoped as (
    select asset, side, size, price, fee_usd, realized_pnl, trade_type,
           "timestamp", tid, start_position
    from fills
    where wallet_address = lower(p_wallet)
      and tid is not null
      and (p_coin = '' or asset = p_coin)
      and "timestamp" >= (select t_from from bounded)
      and "timestamp" <= (select t_to   from bounded)
    -- Ascending: the window is the subject, so a cap that bites must drop
    -- the TAIL, never the head. Dropping the head would move the episode's
    -- opening and silently redraw its boundaries.
    order by "timestamp" asc, tid asc
    limit (select lim from bounded)
  ),
  served as (
    select count(*) as n from scoped
  )
  select jsonb_build_object(
    'total', case
               when (select n from served) < (select lim from bounded)
                 then (select n from served)
               else (
                 select count(*)
                 from fills
                 where wallet_address = lower(p_wallet)
                   and tid is not null
                   and (p_coin = '' or asset = p_coin)
                   and "timestamp" >= (select t_from from bounded)
                   and "timestamp" <= (select t_to   from bounded)
               )
             end,
    'n', (select n from served),
    'rows', coalesce((
      select jsonb_agg(
               jsonb_build_array(
                 asset, side, size, price, fee_usd, realized_pnl, trade_type,
                 (extract(epoch from "timestamp") * 1000)::bigint,
                 tid, start_position
               )
               order by "timestamp" asc, tid asc
             )
      from scoped
    ), '[]'::jsonb)
  )
$$;

notify pgrst, 'reload schema';
