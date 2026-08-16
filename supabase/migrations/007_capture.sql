-- Forward-capture daemon support (Prompt A0).

-- Idempotent fill writes need the exchange trade id; start_position preserves
-- the completeness ground truth (signed pre-fill position) that the original
-- fills schema dropped. Legacy rows keep NULL tid (NULLs never conflict).
alter table fills add column if not exists tid bigint;
alter table fills add column if not exists start_position double precision;
create unique index if not exists idx_fills_wallet_tid on fills (wallet_address, tid);

-- 1m candles. Hypertable when TimescaleDB is available, plain table otherwise.
create table if not exists candles_1m (
  coin text not null,
  t timestamptz not null,
  o double precision not null,
  h double precision,
  l double precision,
  c double precision,
  v double precision,
  primary key (coin, t)
);
do $$
begin
  if exists (select 1 from pg_extension where extname = 'timescaledb') then
    perform public.create_hypertable('candles_1m', 't', if_not_exists => true, migrate_data => true);
  end if;
end $$;

-- Heartbeats: one row per minute from the daemon; the app's "capture live"
-- indicators read the latest row.
create table if not exists capture_health (
  id bigserial primary key,
  service text not null default 'capture',
  ts timestamptz not null default now(),
  ws_connected boolean,
  fills_written_1m int,
  candles_written_1m int,
  wallets_ws int,
  wallets_polled int,
  coins_tracked int,
  note text
);
create index if not exists idx_capture_health_ts on capture_health (ts desc);

-- Wallet+coin pairs whose history begins mid-position (startPosition != 0 on
-- the earliest retrievable fill): their pre-capture history is incomplete and
-- replay engines must not fabricate entries for them.
create table if not exists capture_gaps (
  id bigserial primary key,
  wallet_address text not null,
  coin text not null,
  first_start_position double precision,
  detected_at timestamptz not null default now(),
  unique (wallet_address, coin)
);
