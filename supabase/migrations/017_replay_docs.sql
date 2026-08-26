-- Replay v2.1: precomputed replay documents.
--
-- One row per (wallet, requested coin, request params): a compact serialized
-- playback document — coarsened candles, trade events, running position and
-- realized-PnL series, episode index — built once and served on every later
-- view. The row is REPLACED when the build inputs change (append/replace
-- semantics); the primary key is the content hash of
-- (wallet, coin, params, last_fill_id), so history growth naturally produces
-- a new identity and the freshness check (built_through vs the wallet's
-- newest captured fill) decides when the old row stops being served.
--
-- Docs contain only what the public replay APIs already serve (real fills at
-- exchange-reported prices, real candles, honest coverage blocks) — public
-- read is as safe here as it is on `fills`. Writes go through the service
-- role only (the doc API route and the verify-service pre-builder).

create table if not exists replay_docs (
  content_hash   text primary key,          -- sha256(wallet|coin|params|last_fill_id)
  wallet_address text not null,
  -- '' means "server-resolved default coin" (the landing view / pre-built doc).
  coin_key       text not null default '',
  params_hash    text not null,             -- sha256 of the canonical request params
  params         jsonb not null,
  source         text not null check (source in ('store', 'exchange')),
  -- Newest fill (tid + timestamp) included in the build, within the doc's
  -- scope (the coin for coin-scoped docs, the whole wallet for the default
  -- doc). Null when the wallet had no fills at build time.
  last_fill_id   bigint,
  built_through  timestamptz,
  fill_count     integer not null,
  doc            jsonb not null,
  doc_bytes      integer not null,
  build_ms       integer not null,
  built_at       timestamptz not null default now(),
  -- Exchange-sourced (pasted, non-cohort) docs carry a short TTL: the
  -- exchange's ~10K-fill window slides, so these go stale by time, not by
  -- our capture stream. Null for store-sourced docs (fill-lag governs those).
  expires_at     timestamptz
);

-- One live row per (wallet, coin, params): rebuilds land on this key.
create unique index if not exists idx_replay_docs_key
  on replay_docs (wallet_address, coin_key, params_hash);

-- The pre-builder sweeps by wallet; staleness checks read single rows off
-- the key index above. This one serves "oldest docs first" maintenance.
create index if not exists idx_replay_docs_built_at on replay_docs (built_at);

alter table replay_docs enable row level security;

do $$ begin
  create policy "public read" on replay_docs for select using (true);
exception when duplicate_object then null; end $$;
