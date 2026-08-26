-- Replay v2.2: one coin's fills in ONE round trip.
--
-- Measured, not assumed: PostgREST truncates at 1,000 rows for RPCs exactly
-- as it does for table reads (asked for 5,000/10,000/30,000 rows from a
-- set-returning function, got exactly 1,000 back every time, no error and no
-- flag — the CLAUDE.md rule, now confirmed for the RPC surface too). So a
-- 26,000-fill coin meant 27 HTTP round trips, and those round trips — not
-- the database, which answers a page in 18-35 ms — were the entire cold
-- path: ~13 s of the 16 s to first bar.
--
-- The cap counts ROWS, so a function returning a single jsonb row is not
-- subject to it. This returns one row: the scope's fills as compact arrays,
-- ascending, with the exact total alongside so the caller can DECLARE
-- truncation rather than infer it.
--
-- Still bounded, in three ways: an explicit p_limit from the caller
-- (STORE_MAX_FILLS), a hard ceiling of 100,000 inside the function, and the
-- honest `total` that says what the limit left out. When the limit bites,
-- the rows served are the most RECENT ones (newest-first limit, re-sorted
-- ascending) — the same slice the paged reader served, and the same one the
-- coverage block calls capped.
--
-- Row shape (positional, matches the app's StoreFillRow):
--   [asset, side, size, price, fee_usd, realized_pnl, trade_type,
--    timestamp_ms, tid, start_position]
-- Timestamps travel as epoch milliseconds: the app wants a number, and
-- parsing 26,000 ISO strings in the request path is work for nothing.
-- Nulls stay null — fee_usd, realized_pnl and start_position are nullable
-- and the app distinguishes "not reported" from zero.

create or replace function replay_wallet_fills_json(
  p_wallet text,
  p_coin   text,
  p_limit  int
) returns jsonb
language sql
stable
as $$
  with scoped as (
    select asset, side, size, price, fee_usd, realized_pnl, trade_type,
           "timestamp", tid, start_position
    from fills
    where wallet_address = lower(p_wallet)
      and tid is not null
      and (p_coin = '' or asset = p_coin)
    order by "timestamp" desc, tid desc
    limit least(greatest(p_limit, 0), 100000)
  )
  select jsonb_build_object(
    'total', (
      select count(*)
      from fills
      where wallet_address = lower(p_wallet)
        and tid is not null
        and (p_coin = '' or asset = p_coin)
    ),
    'n', (select count(*) from scoped),
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

-- The row-cap probe from that measurement was a diagnostic, not a surface.
drop function if exists replay_probe_rowcap(text, text, int);

notify pgrst, 'reload schema';
