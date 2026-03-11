-- Signals table for smart money trading signals
CREATE TABLE IF NOT EXISTS signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  wallet_address TEXT NOT NULL,
  wallet_label TEXT,
  coin TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long', 'short')),
  entry_price NUMERIC NOT NULL,
  notional_usd NUMERIC NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  source TEXT NOT NULL DEFAULT 'hyperliquid_smart_money',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dismissed', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying active signals
CREATE INDEX IF NOT EXISTS idx_signals_status_timestamp ON signals (status, timestamp DESC);

-- Index for filtering by coin
CREATE INDEX IF NOT EXISTS idx_signals_coin ON signals (coin);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_signals_expires_at ON signals (expires_at) WHERE status = 'active';

-- Index for lookup by signal_id
CREATE INDEX IF NOT EXISTS idx_signals_signal_id ON signals (signal_id);
