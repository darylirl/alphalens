-- Enable TimescaleDB
create extension if not exists timescaledb;

-- Tracked wallets master table
create table wallets (
  address text primary key,
  label text,
  archetype text,
  archetype_confidence float,
  sharpe_7d float,
  sharpe_30d float,
  sharpe_90d float,
  alpha_decay_score float,
  win_rate float,
  total_pnl_usd float,
  trade_count_30d int,
  avg_hold_seconds int,
  avg_leverage float,
  most_traded_asset text,
  is_seeded boolean default false,
  last_updated timestamptz default now(),
  created_at timestamptz default now()
);

-- Raw fills time-series
create table fills (
  id bigserial,
  wallet_address text references wallets(address),
  asset text not null,
  side text not null,
  size float not null,
  price float not null,
  fee_usd float,
  realized_pnl float,
  hold_duration_seconds int,
  trade_type text,
  timestamp timestamptz not null
);

select create_hypertable('fills', 'timestamp');
create index on fills (wallet_address, timestamp desc);

-- Position snapshots
create table positions (
  id bigserial,
  wallet_address text references wallets(address),
  asset text not null,
  side text not null,
  size float not null,
  entry_price float not null,
  mark_price float,
  leverage float,
  unrealized_pnl float,
  margin_used float,
  snapshot_at timestamptz default now()
);

select create_hypertable('positions', 'snapshot_at');

-- Alert events log
create table alerts (
  id bigserial primary key,
  wallet_address text,
  event_type text not null,
  asset text,
  side text,
  size float,
  price float,
  leverage float,
  details jsonb,
  triggered_at timestamptz default now()
);

-- User watchlists
create table watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  wallet_addresses text[] default '{}',
  created_at timestamptz default now()
);

-- Quant rules
create table quant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  rule_json jsonb not null,
  is_active boolean default true,
  paper_pnl float default 0,
  trigger_count int default 0,
  created_at timestamptz default now()
);

-- Alert delivery config
create table alert_configs (
  user_id text primary key,
  telegram_chat_id text,
  ntfy_topic text,
  min_position_size float default 5000,
  archetypes_filter text[] default '{}',
  created_at timestamptz default now()
);
