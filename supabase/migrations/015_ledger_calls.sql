-- The Ledger (Prompt F): public, append-only, scored calls.
--
-- A call is a claim published in advance of (or alongside) its evidence:
--   * kind='hypothesis_verdict' — the adjudicated outcome of a verification
--     run. The evidence already exists (an immutable verification_results row
--     or the published research + backtest_results/ artifacts), so the call is
--     born final: it never carries a resolution block.
--   * kind='cohort_signal' — a forward-looking probabilistic call that
--     resolves at published_at + horizon against captured tape. Only the
--     scoring worker may fill its resolution block, exactly once.
--
-- Append-only enforcement copies verification_results: UPDATE/DELETE revoked
-- and trigger-rejected. The single carved-out door is the one-time resolution
-- write — a column-level UPDATE grant on the four resolution columns only,
-- and a trigger that verifies the update is exactly "fill a NULL resolution
-- block, touch nothing else". A wrong call is never edited; the record of
-- being wrong IS the product.
--
-- No per-wallet verdicts anywhere: enforced in ledger_subject_ok, not just in
-- app code — a subject naming a wallet address cannot be inserted at all.

-- ── Shape guards ────────────────────────────────────────────────────────────

create or replace function ledger_subject_ok(s jsonb) returns boolean
language sql immutable parallel safe as $$
  select jsonb_typeof(s) = 'object'
     and s ? 'scope'
     and (s->>'scope') in ('strategy', 'cohort')       -- aggregate/strategy level only
     and not (s ? 'wallet')                            -- never a per-wallet verdict
     and not (s ? 'wallet_address')
     and not (s ? 'address')
$$;

create or replace function ledger_provenance_ok(p jsonb) returns boolean
language sql immutable parallel safe as $$
  select jsonb_typeof(p) = 'object'
     and p ? 'engine'
     and length(p->>'engine') > 0
$$;

-- ── The calls table ─────────────────────────────────────────────────────────

create table if not exists ledger_calls (
  id            bigserial primary key,
  published_at  timestamptz not null default now(),
  kind          text        not null,
  subject       jsonb       not null,
  claim         text        not null,
  confidence    numeric,          -- P(claim true); null for verdict calls
  provenance    jsonb       not null,   -- {engine, spec_hash, result_id, ...}
  horizon_hours numeric     not null,
  resolves_at   timestamptz,

  -- Resolution block: written only by the scoring worker, exactly once.
  resolved_at         timestamptz,
  outcome             text,
  scored_brier        numeric,
  resolution_evidence jsonb,      -- prices/coverage the resolution rests on

  constraint ledger_calls_kind
    check (kind in ('hypothesis_verdict', 'cohort_signal')),
  constraint ledger_calls_subject_shape    check (ledger_subject_ok(subject)),
  constraint ledger_calls_claim            check (length(btrim(claim)) >= 10),
  constraint ledger_calls_provenance_shape check (ledger_provenance_ok(provenance)),
  constraint ledger_calls_horizon          check (horizon_hours > 0),
  constraint ledger_calls_confidence
    check (confidence is null or (confidence > 0 and confidence < 1)),

  -- A cohort_signal must be scoreable at publication: a stated probability
  -- and a stated resolution instant. Without both, Brier scoring would be
  -- retrofitted after the fact, which is the thing this table exists to
  -- make impossible.
  constraint ledger_calls_signal_scoreable
    check (kind <> 'cohort_signal'
           or (confidence is not null and resolves_at is not null)),

  -- A verdict call is born final; only signals resolve.
  constraint ledger_calls_only_signals_resolve
    check (resolved_at is null or kind = 'cohort_signal'),

  -- The resolution block is all-or-nothing, and an outcome always carries its
  -- evidence. 'unresolvable' (a permanent data gap at the resolution instant)
  -- carries no Brier score: a gap is the absence of measurement, and scoring
  -- it either way would fabricate one.
  constraint ledger_calls_resolution_block check (
    (resolved_at is null and outcome is null
       and scored_brier is null and resolution_evidence is null)
    or
    (resolved_at is not null
       and outcome in ('correct', 'incorrect', 'unresolvable')
       and resolution_evidence is not null
       and case when outcome = 'unresolvable'
                then scored_brier is null
                else scored_brier is not null
                     and scored_brier >= 0 and scored_brier <= 1
           end)
  )
);

create index if not exists idx_ledger_calls_published
  on ledger_calls (published_at desc);
create index if not exists idx_ledger_calls_due
  on ledger_calls (resolves_at)
  where kind = 'cohort_signal' and resolved_at is null;

-- One call per verification result: the auto-publisher is at-least-once, so
-- idempotency lives here, not in application memory.
create unique index if not exists uq_ledger_calls_result
  on ledger_calls (((provenance->>'result_id')::bigint))
  where provenance ? 'result_id';

-- ── Append-only, enforced by the database ───────────────────────────────────

create or replace function ledger_calls_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'ledger_calls is append-only: DELETE is not permitted. A wrong call stays; publish a new one.';
  end if;

  -- The only permitted UPDATE: fill a NULL resolution block, once.
  if old.resolved_at is not null then
    raise exception
      'ledger_calls id=% is already resolved; resolutions are immutable', old.id;
  end if;
  if new.resolved_at is null then
    raise exception
      'ledger_calls is append-only: the only permitted update writes the resolution block';
  end if;
  if new.id            is distinct from old.id
     or new.published_at  is distinct from old.published_at
     or new.kind          is distinct from old.kind
     or new.subject       is distinct from old.subject
     or new.claim         is distinct from old.claim
     or new.confidence    is distinct from old.confidence
     or new.provenance    is distinct from old.provenance
     or new.horizon_hours is distinct from old.horizon_hours
     or new.resolves_at   is distinct from old.resolves_at then
    raise exception
      'ledger_calls is append-only: only the resolution block may be written, nothing else on id=%', old.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_ledger_calls_append_only on ledger_calls;
create trigger trg_ledger_calls_append_only
  before update or delete on ledger_calls
  for each row execute function ledger_calls_append_only();

-- ── Grants / RLS: public read, service-role insert, resolution-only update ──

alter table ledger_calls enable row level security;

drop policy if exists "public read" on ledger_calls;
create policy "public read" on ledger_calls for select using (true);

revoke all on ledger_calls from anon, authenticated;
grant select on ledger_calls to anon, authenticated;

revoke update, delete, truncate on ledger_calls from anon, authenticated, service_role;
grant insert, select on ledger_calls to service_role;
-- The one door: the scoring worker (service role) may write the resolution
-- columns. The trigger above still verifies the write is a one-time fill.
grant update (resolved_at, outcome, scored_brier, resolution_evidence)
  on ledger_calls to service_role;

grant usage on sequence ledger_calls_id_seq to service_role;
