-- Replay v2.2: the per-coin menu aggregate.
--
-- The replay page's first paint is a pair-selection grid: which coins the
-- wallet traded, how much, when, and what it realized. Building that grid by
-- paging a cohort wallet's full captured history through PostgREST is exactly
-- the 4.7–16s cold path this release removes — so the aggregate is pushed
-- into SQL (per CLAUDE.md: never aggregate client-side over an unbounded
-- table read) and the app reads the small result.
--
-- Bounded on purpose: one wallet's rows off the (wallet_address, timestamp)
-- index, grouped by asset, at most 200 coins returned (most-traded first —
-- the LIMIT is a declared cap, and the caller reports when it is hit).
-- Only capture-daemon rows count (tid is not null), the same rule the fills
-- reader applies. NULL realized_pnl rows contribute nothing to the sum,
-- matching the fills reader's treatment (null closedPnl reads as 0).

create or replace function replay_coin_menu(p_wallet text)
returns table (
  coin         text,
  fill_count   bigint,
  first_fill   timestamptz,
  last_fill    timestamptz,
  realized_pnl double precision
)
language sql
stable
as $$
  select
    asset as coin,
    count(*) as fill_count,
    min("timestamp") as first_fill,
    max("timestamp") as last_fill,
    coalesce(sum(realized_pnl), 0)::double precision as realized_pnl
  from fills
  where wallet_address = lower(p_wallet)
    and tid is not null
  group by asset
  order by count(*) desc
  limit 200
$$;

notify pgrst, 'reload schema';
