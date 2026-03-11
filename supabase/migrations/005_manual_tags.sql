-- Add manually_tagged flag and soft-delete support to wallets table
alter table wallets add column if not exists manually_tagged boolean default false;
alter table wallets add column if not exists removed_at timestamptz;
