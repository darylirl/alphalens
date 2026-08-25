-- 011: Capture scope-down.
--
-- The daemon was sweeping all ~7,000 tracked wallets; fills reached 3.8GB
-- and was growing 4-10GB/month. Capture now concentrates on the classified
-- cohort via an enforced flag rather than a convention:
--
--   wallets.capture_enabled (default false) is true for
--     1. every classified wallet (archetype not null, not removed),
--     2. every wallet referenced by an active signal,
--     3. every wallet address appearing in a verification job spec.
--
-- The capture daemon (capture-service/index.mjs, SWEEP_SCOPE=cohort) reads
-- only capture_enabled wallets for both its WS subscription set and its
-- rotating REST sweep. Existing fills from out-of-scope wallets are kept;
-- they simply stop accumulating. Nothing is deleted.

alter table public.wallets
  add column if not exists capture_enabled boolean not null default false;

-- 1. Classified cohort.
update public.wallets
   set capture_enabled = true
 where archetype is not null
   and removed_at is null
   and not capture_enabled;

-- 2. Wallets referenced by active signals.
update public.wallets w
   set capture_enabled = true
  from (select distinct lower(wallet_address) as addr
          from public.signals
         where status = 'active' and expires_at > now()) s
 where lower(w.address) = s.addr
   and w.removed_at is null
   and not w.capture_enabled;

-- 3. Wallet addresses appearing anywhere in a verification spec.
update public.wallets w
   set capture_enabled = true
  from (select distinct lower(m[1]) as addr
          from public.verification_jobs j,
               regexp_matches(j.spec::text, '(0x[0-9a-fA-F]{40})', 'g') m) s
 where lower(w.address) = s.addr
   and w.removed_at is null
   and not w.capture_enabled;

-- Hot path for the daemon's paginated reads.
create index if not exists idx_wallets_capture_enabled
  on public.wallets (address)
  where capture_enabled and removed_at is null;
