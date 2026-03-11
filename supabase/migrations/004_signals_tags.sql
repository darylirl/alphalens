-- Add wallet tags to the signals table for archetype display
alter table signals add column if not exists wallet_tags text[] default '{}';
