import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { BottomNav } from '@/components/layout/BottomNav'

// Static methodology page for the Ledger. No database reads: the rules
// documented here are enforced in code and in the database, and this page is
// just the plain-language statement of them.

export const metadata: Metadata = {
  title: 'Ledger methodology — AlphaLens',
  description:
    'How AlphaLens Ledger calls are published, what may reach them, and how they are scored — including why data gaps are never scored.',
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-bold text-[#F0FAF8] mt-6 mb-2">{children}</h2>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-white/70 leading-relaxed mb-3">{children}</p>
}

export default function LedgerMethodologyPage() {
  return (
    <div className="pb-20 md:pb-8">
      <div className="px-4 py-4 lg:px-6 max-w-2xl mx-auto">
        <Link href="/ledger" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-[#34EAB9] transition-colors mb-4">
          <ArrowLeft size={12} /> The Ledger
        </Link>

        <h1 className="text-lg font-bold mb-1">How the Ledger works</h1>
        <P>
          The Ledger is our public track record: every call we publish,
          timestamped, with its evidence attached, scored in the open. Its
          value depends entirely on it being impossible to quietly clean up —
          so immutability and honesty rules are enforced by the database, not
          by policy.
        </P>

        <H2>Append-only, by database enforcement</H2>
        <P>
          The calls table revokes UPDATE and DELETE from every role and
          rejects both in a trigger. The single exception is a one-time write
          of the resolution block (outcome, Brier score, evidence) by the
          scoring worker; the trigger verifies nothing else changes and that a
          resolution is never overwritten. A wrong call stays on the record
          forever. A wrong verification result is answered by re-running the
          spec and publishing a new call — never by editing history.
        </P>

        <H2>What may be published</H2>
        <P>
          A hypothesis verdict reaches the Ledger only if it was produced by
          the canonical verification engine and its pre-registered spec still
          validates against the current rule grammar — meaning the engine
          could re-run it today. Everything else is recorded internally but
          not published, including honest results from earlier experimental
          engines. Every replay behind a verdict applies at least a 60-second
          decision-to-fill delay, 5 basis points of adverse slippage, and
          0.045% taker fee per side; specs below those floors are rejected
          outright, in validation and again by a database constraint.
        </P>

        <H2>What a forward call must clear before it is published</H2>
        <P>
          A cohort signal claims the tracked cohort is positioned a certain
          way. Five criteria, pre-registered on 27 August 2026 — before any
          cohort signal had been published, so no call has ever been made
          under a looser rule — decide whether a reading is allowed to become
          one. A coin must clear all five, in the direction being called:
        </P>
        <ul className="text-xs text-white/70 leading-relaxed mb-3 list-disc pl-5 space-y-1">
          <li><strong className="text-white/85">Skew at least 5%</strong> of notional directed one way. A balanced book is not a directional call.</li>
          <li><strong className="text-white/85">Notional at least $250,000</strong> over the rolling 24 hours.</li>
          <li><strong className="text-white/85">At least 3 active wallets</strong> trading the coin at all.</li>
          <li><strong className="text-white/85">At least 10 wallets</strong> trading the called side specifically.</li>
          <li><strong className="text-white/85">No single wallet above 40%</strong> of the notional directed that way.</li>
        </ul>
        <P>
          The last two exist because the first three were not enough. The first
          reading ever to clear skew, notional and wallet count was HYPE on 27
          August 2026: 62% of its notional directed short, across seven active
          wallets — of which one held roughly two thirds of the short side.
          Every floor passed and the reading was still one trader&apos;s position
          wearing a cohort&apos;s clothes. Skew measures how lopsided the book is.
          These two measure how many hands made it that way.
        </P>
        <P>
          Concentration is read for the called direction only: a crowded long
          side does not make a concentrated short call honest. Where the
          concentration of a coin has not been measured, the call is refused
          rather than published — an unmeasured floor is not a passed one, and
          treating &ldquo;we did not measure&rdquo; as &ldquo;not concentrated&rdquo; would be the
          most permissive possible reading of the least evidence.
        </P>
        <P>
          The consequence is that some days no coin qualifies and nothing is
          published. That is the intended behaviour, not a gap in the record:
          the Ledger waits rather than lowering a bar to fill a slot.
        </P>

        <H2>How forward calls are scored</H2>
        <P>
          A forward call (a cohort signal) states its claim, its confidence,
          and its resolution time at publication. At the horizon, the scorer
          reads the first captured print at or after the publication instant
          and the resolution instant — 1-minute candles first, cohort fills as
          fallback, each within a bounded 15-minute search. The outcome is
          scored as a Brier score: (confidence − outcome)², where outcome is 1
          if the claim came true and 0 if it did not. Lower is better; 0.25 is
          what always saying 50% scores.
        </P>

        <H2>Data gaps are never scored</H2>
        <P>
          Missing data is never read as zero, and never as a price. If the
          captured tape has no print near either instant, the scorer waits out
          a grace period for late-arriving capture, then marks the call
          unresolvable — with the gap documented, and no Brier score in either
          direction. The calibration curve excludes unresolvable calls for the
          same reason, and appears only once ten or more calls have actually
          resolved.
        </P>

        <H2>Aggregate only</H2>
        <P>
          Calls are about strategies and cohort aggregates. No call names or
          scores an individual wallet, and the database rejects a call whose
          subject contains one.
        </P>

        <P>
          The verdicts published here trace to immutable verification result
          rows and to public research with its artifacts, such as the{' '}
          <Link href="/research/copy-trading-autopsy" className="text-[#34EAB9] hover:underline">
            copy-trading autopsy
          </Link>
          . Nothing on the Ledger is a recommendation.
        </P>
      </div>

      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
