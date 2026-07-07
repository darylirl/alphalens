-- One active signal per wallet+coin+side: race-proof guard against
-- duplicate signal flooding from the live trade stream (market makers
-- print $50K+ trades continuously; without this, each one inserts).
create unique index if not exists idx_signals_one_active
  on signals (wallet_address, coin, side) where status = 'active';
