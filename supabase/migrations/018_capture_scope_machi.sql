-- 018: Bring Machi Big Brother into capture scope.
--
-- 0x020ca66c30bec2c4fe3861a94e4db4a498a35872 is a publicly notable wallet and
-- a curation candidate, but it has never satisfied any of the three
-- capture-scope criteria from migration 014: it is unclassified
-- (archetype is null), no active signal references it, and it appears in no
-- verification job spec. The 63,903 fills the store holds for it were not
-- captured by the cohort daemon at all — they were written during two
-- full-scope (SWEEP_SCOPE=all) daemon runs, and they stop mid-history at a
-- pagination boundary, not at a wallet or market event:
--
--   rows      1 - 60,000   2026-04-19 -> 2026-05-13 13:46   initial backfill,
--                                                           BACKFILL_MAX_PAGES=30
--                                                           x 2000 rows, exactly
--   rows 60,001 - 61,903   -> 2026-05-14 15:27              one sweep page
--   rows 61,904 - 63,903   2026-06-25 -> 2026-06-29         one sweep page,
--                                                           exactly 2000 rows
--
-- The final chunk being exactly one full API page is the tell: the sweep hit
-- the per-request cap with more history still available and was never called
-- again, because the wallet is out of scope for the cohort-scoped daemon.
--
-- Capacity note (measured 2026-08-26 against the live Hyperliquid API): the
-- exchange's retained window for this wallet holds 191,707 fills from
-- 2026-07-07 to 2026-08-26. Its rate is not stable — it averaged ~3,800
-- fills/day over that window but ~22,100 fills/day over the trailing 7 days
-- after a step change in activity on 2026-08-19. Enabling capture therefore
-- adds roughly 115k fills/month at the window average and up to ~660k
-- fills/month if the current regime holds (~29% of the 2.29M fills the whole
-- 172-wallet capture scope took in the trailing 30 days), plus a one-time
-- catch-up of whatever the API still retains. Revisit the flag if the wallet
-- is later classified market_maker, which would put it out of scope under
-- migration 016.
--
-- The store's window and the exchange's retained window do not overlap
-- (store ends 2026-06-29 14:14, retention now begins 2026-07-07 04:44), so
-- enabling capture cannot heal the hole between them. Nothing is backfilled
-- or synthesized here: capture simply resumes from what the API still holds,
-- and the gap stays a gap.

update public.wallets
   set capture_enabled = true
 where lower(address) = '0x020ca66c30bec2c4fe3861a94e4db4a498a35872'
   and removed_at is null
   -- Migration 016: market makers are out of capture scope by behavior.
   and (archetype is distinct from 'market_maker')
   and not capture_enabled;
