-- Add tags column to wallets table for archetype categorization
alter table wallets add column if not exists tags text[] default '{}';

-- Add index for faster tag-based queries
create index if not exists idx_wallets_tags on wallets using gin(tags);
