-- 016: Exclude market-maker wallets from capture scope.
--
-- Measured before this change (2026-08-25): 369 of the 545 capture-enabled
-- wallets were archetype = 'market_maker', and they accounted for ~4.15M of
-- the ~5.99M capture-scope fills over the trailing 30 days (~69%). Their flow
-- is market-neutral inventory churn: it dominates disk growth and pollutes
-- /pulse's long/short skew with directionless noise (12 of the top-20 pulse
-- coins were majority-MM notional in the 24h before this change).
--
-- Capture is a directional-signal instrument, so market makers leave the
-- capture scope. Nothing is deleted: their wallet rows, classification, and
-- all previously captured fills remain; they simply stop accumulating.
-- The 7 MM wallets referenced by active signals are excluded too — the
-- exclusion is by behavior, and their existing history stays available to
-- any replay that needs it.
--
-- NOTE: the capture-scope reference clause (migration 014 rule 2: any wallet
-- referenced by an active signal is capture_enabled) requires signal-source
-- filtering upstream (lib/signals/generate.ts archetype gate) — otherwise a
-- new signal on an excluded wallet resurrects excluded archetypes into scope.

update public.wallets
   set capture_enabled = false
 where archetype = 'market_maker'
   and capture_enabled;
