-- Replay v2.2: stop paying for a second scan to learn something we already
-- know.
--
-- replay_wallet_fills_json returns the exact `total` alongside the rows it
-- served, so truncation is declared rather than inferred. But it computed
-- that total with a second count over the same predicate — doubling the work
-- for every wallet, including the large majority that are nowhere near the
-- cap.
--
-- When fewer rows came back than the limit allowed, the rows ARE the whole
-- scope and the total is their count: no second scan can tell us anything
-- new. The count only has to run when the limit actually bit. A CASE keeps
-- the honest answer in both branches — this makes `total` cheaper, never
-- less true.
--
-- Why it matters beyond latency: the anon role carries statement_timeout=3s
-- (service_role carries none), so a deployment holding only the anon key had
-- cohort reads abort with 57014 on cold buffers and fall back to the
-- exchange's shallow recent window. Halving the scan widens the margin
-- before that happens.

create or replace function replay_wallet_fills_json(
  p_wallet text,
  p_coin   text,
  p_limit  int
) returns jsonb
language sql
stable
as $$
  with bounded as (
    select least(greatest(p_limit, 0), 100000) as lim
  ),
  scoped as (
    select asset, side, size, price, fee_usd, realized_pnl, trade_type,
           "timestamp", tid, start_position
    from fills
    where wallet_address = lower(p_wallet)
      and tid is not null
      and (p_coin = '' or asset = p_coin)
    order by "timestamp" desc, tid desc
    limit (select lim from bounded)
  ),
  served as (
    select count(*) as n from scoped
  )
  select jsonb_build_object(
    -- Short of the limit means the rows are the whole scope: their count IS
    -- the total. Only a full page can be hiding more, and only then do we
    -- pay for the count.
    'total', case
               when (select n from served) < (select lim from bounded)
                 then (select n from served)
               else (
                 select count(*)
                 from fills
                 where wallet_address = lower(p_wallet)
                   and tid is not null
                   and (p_coin = '' or asset = p_coin)
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
