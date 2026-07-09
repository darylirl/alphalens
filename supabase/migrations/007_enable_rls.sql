-- Enable row level security on all public tables. The public anon key
-- becomes read-only; writes require the service-role key, which only the
-- server holds (SUPABASE_SERVICE_ROLE_KEY — set in Vercel production env).
-- Without this, anyone with the anon key could write to every table
-- directly via PostgREST, bypassing the app's admin gate entirely.

alter table wallets enable row level security;
alter table signals enable row level security;
alter table fills enable row level security;
alter table positions enable row level security;
alter table alerts enable row level security;
alter table watchlists enable row level security;
alter table quant_rules enable row level security;
alter table alert_configs enable row level security;

-- Public read access (the app's read paths and any anon consumers keep working)
create policy "public read" on wallets for select using (true);
create policy "public read" on signals for select using (true);
create policy "public read" on fills for select using (true);
create policy "public read" on positions for select using (true);
create policy "public read" on alerts for select using (true);
create policy "public read" on watchlists for select using (true);
create policy "public read" on quant_rules for select using (true);
create policy "public read" on alert_configs for select using (true);
