/**
 * The Ledger's Telegram mirror.
 *
 * Two things are worth pinning down here, and they are the two ways a mirror
 * can lie: posting something the Ledger does not say, and posting it twice.
 * Everything else — pacing, 429s — is politeness.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

// Read at module load, so they must be set before the import below.
process.env.LEDGER_TELEGRAM_MIN_INTERVAL_MS = '0'
process.env.LEDGER_PUBLIC_URL = 'https://alphalens.test/'

const {
  formatCall, formatResolution, announce, announceSweep, resetFailed, ledgerTelegramConfigured,
} = await import('../lib/telegram.mjs')

const verdictCall = {
  id: 2,
  kind: 'hypothesis_verdict',
  published_at: '2026-08-25T13:08:32Z',
  subject: { scope: 'strategy', strategy: 'spec_replay', coins: ['BTC'], verdict: 'killed' },
  claim: 'KILLED: "cohort net flow flip precedes higher BTC." — 35 trades, net $-66.55.',
  confidence: null,
  horizon_hours: '1440',
  resolves_at: null,
  provenance: { engine: 'verify-engine@1.0.0', result_id: 5, job_id: 4 },
}

const signalCall = {
  id: 9,
  kind: 'cohort_signal',
  published_at: '2026-08-20T00:00:00Z',
  resolves_at: '2026-08-21T00:00:00Z',
  confidence: '0.7',
  horizon_hours: '24',
  subject: { scope: 'cohort', coin: 'BTC', direction: 'up' },
  claim: 'BTC higher in 24h on cohort flow flip.',
  provenance: { engine: 'verify-engine@1.0.0' },
}

// ── message text ────────────────────────────────────────────────────────────

test('a verdict call posts its kind, verdict, claim, evidence and permalink', () => {
  const msg = formatCall(verdictCall)
  assert.match(msg, /^Ledger call #2 — hypothesis verdict$/m)
  assert.match(msg, /^Verdict: KILLED$/m)
  assert.match(msg, /^Evidence window: 1,440 h replayed$/m)
  assert.match(msg, /^Evidence: verify-engine@1\.0\.0, result #5$/m)
  assert.ok(msg.includes(verdictCall.claim))
  assert.match(msg, /https:\/\/alphalens\.test\/ledger\/2$/)
  // A verdict call has no confidence; inventing one would be a claim we
  // never made.
  assert.doesNotMatch(msg, /Confidence/)
})

test('a signal call posts its confidence and horizon, and when it resolves', () => {
  const msg = formatCall(signalCall)
  assert.match(msg, /^Ledger call #9 — cohort signal$/m)
  assert.match(msg, /^Confidence: 70%$/m)
  assert.match(msg, /^Horizon: 24 h — resolves 2026-08-21 00:00 UTC$/m)
  assert.match(msg, /https:\/\/alphalens\.test\/ledger\/9$/)
})

test('a resolution posts the outcome, the Brier score and the permalink', () => {
  const msg = formatResolution({ ...signalCall, outcome: 'correct', scored_brier: '0.09' })
  assert.match(msg, /^Ledger call #9 resolved — CORRECT$/m)
  assert.match(msg, /^Brier score: 0\.090 \(0 = perfect, 1 = maximally wrong\)$/m)
  assert.match(msg, /^Called at 70% confidence\.$/m)
  assert.match(msg, /https:\/\/alphalens\.test\/ledger\/9$/)
})

test('an unresolvable call is posted with NO Brier score and says why', () => {
  const msg = formatResolution({ ...signalCall, outcome: 'unresolvable', scored_brier: null })
  assert.match(msg, /UNRESOLVABLE \(data gap\)/)
  assert.match(msg, /^No Brier score: a data gap is never scored either way\.$/m)
  assert.doesNotMatch(msg, /^Brier score:/m, 'a gap must never carry a score')
})

test('messages are plain text: no markup to escape, no emoji to hype', () => {
  for (const msg of [formatCall(verdictCall), formatCall(signalCall),
    formatResolution({ ...signalCall, outcome: 'incorrect', scored_brier: 0.49 })]) {
    assert.doesNotMatch(msg, /\p{Extended_Pictographic}/u, `no emoji in: ${msg}`)
    assert.doesNotMatch(msg, /[*_`[\]]/, `no markdown control characters in: ${msg}`)
  }
})

test('a very long claim is truncated, never dropped — the permalink still lands', () => {
  const msg = formatCall({ ...verdictCall, claim: 'x'.repeat(9000) })
  assert.ok(msg.length < 4096, `message must fit Telegram's limit, got ${msg.length}`)
  assert.match(msg, /…/)
  assert.match(msg, /https:\/\/alphalens\.test\/ledger\/2$/)
})

// ── post-once bookkeeping ───────────────────────────────────────────────────

/** A stand-in for `sb()` over the one table this module writes. */
function fakeDb() {
  const rows = new Map()   // `${call_id}:${phase}` → row
  const calls = []
  let pending = []

  const key = (path) => {
    const q = new URLSearchParams(path.split('?')[1] || '')
    return `${(q.get('call_id') || '').replace('eq.', '')}:${(q.get('phase') || '').replace('eq.', '')}`
  }

  const db = async (path, { method = 'GET', prefer, body } = {}) => {
    calls.push({ path, method, body })

    if (path.startsWith('ledger_telegram_pending')) return pending

    if (method === 'POST') {
      const row = body[0]
      const k = `${row.call_id}:${row.phase}`
      if (rows.has(k)) {
        if (prefer?.includes('ignore-duplicates')) return []
        throw new Error('duplicate key value violates unique constraint (23505)')
      }
      rows.set(k, { posted_at: null, last_error: null, ...row })
      return [rows.get(k)]
    }

    if (method === 'PATCH') {
      // A bulk PATCH (no call_id filter) — resetFailed's shape.
      if (!path.includes('call_id=eq.')) {
        const hit = [...rows.values()].filter((r) => {
          if (path.includes('posted_at=is.null') && r.posted_at !== null) return false
          const gt = path.match(/attempts=gt\.(\d+)/)
          if (gt && !(r.attempts > Number(gt[1]))) return false
          return true
        })
        hit.forEach((r) => Object.assign(r, body))
        return hit
      }

      const k = key(path)
      const row = rows.get(k)
      if (!row) return []
      // Only the filters this module actually uses.
      if (path.includes('posted_at=is.null') && row.posted_at !== null) return []
      const staleMatch = path.match(/claimed_at=lt\.([^&]+)/)
      if (staleMatch && !(Date.parse(row.claimed_at) < Date.parse(decodeURIComponent(staleMatch[1])))) return []
      const attemptsMatch = path.match(/attempts=lt\.(\d+)/)
      if (attemptsMatch && !(row.attempts < Number(attemptsMatch[1]))) return []
      Object.assign(row, body)
      return [row]
    }

    return []
  }

  return { db, rows, calls, setPending: (p) => { pending = p } }
}

function fakeTelegram({ fail = false } = {}) {
  const sent = []
  let nextId = 100
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) })
    if (fail) {
      return { ok: false, status: 400, json: async () => ({ ok: false, description: 'chat not found' }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: nextId++ } }) }
  }
  return sent
}

const withEnv = async (env, fn) => {
  const saved = { ...process.env }
  const savedFetch = globalThis.fetch
  Object.assign(process.env, env)
  try { return await fn() } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]
    }
    globalThis.fetch = savedFetch
  }
}

const CONFIGURED = { LEDGER_TELEGRAM_BOT_TOKEN: 'test:token', LEDGER_TELEGRAM_CHANNEL_ID: '@alphalens_ledger' }

test('unconfigured is a normal state: nothing is sent, nothing throws', async () => {
  await withEnv({ LEDGER_TELEGRAM_BOT_TOKEN: '', LEDGER_TELEGRAM_CHANNEL_ID: '' }, async () => {
    const sent = fakeTelegram()
    const { db } = fakeDb()
    assert.equal(ledgerTelegramConfigured(), false)
    assert.equal(await announce(verdictCall, 'publish', { db }), 'unconfigured')
    assert.equal(sent.length, 0)
  })
})

test('a call is announced once, and a restart does not repeat it', async () => {
  await withEnv(CONFIGURED, async () => {
    const sent = fakeTelegram()
    const { db, rows } = fakeDb()

    assert.equal(await announce(verdictCall, 'publish', { db }), 'posted')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].body.chat_id, '@alphalens_ledger')
    assert.match(sent[0].body.text, /Ledger call #2/)
    const row = rows.get('2:publish')
    assert.equal(row.message_id, 100)
    assert.ok(row.posted_at)

    // Same call, same phase, fresh process: the claim is in the database.
    assert.equal(await announce(verdictCall, 'publish', { db }), 'skipped')
    assert.equal(sent.length, 1, 'a second announce must not reach Telegram')
  })
})

test('publish and resolution are separate announcements of the same call', async () => {
  await withEnv(CONFIGURED, async () => {
    const sent = fakeTelegram()
    const { db } = fakeDb()
    const resolved = { ...signalCall, outcome: 'correct', scored_brier: 0.09, resolved_at: '2026-08-21T00:05:00Z' }

    assert.equal(await announce(signalCall, 'publish', { db }), 'posted')
    assert.equal(await announce(resolved, 'resolution', { db }), 'posted')
    assert.equal(sent.length, 2)
    assert.match(sent[0].body.text, /Ledger call #9 — cohort signal/)
    assert.match(sent[1].body.text, /Ledger call #9 resolved — CORRECT/)
  })
})

test('a Telegram failure is recorded and returned, never thrown at the caller', async () => {
  await withEnv(CONFIGURED, async () => {
    fakeTelegram({ fail: true })
    const { db, rows } = fakeDb()

    assert.equal(await announce(verdictCall, 'publish', { db }), 'failed')
    const row = rows.get('2:publish')
    assert.equal(row.posted_at, null, 'a failed post must stay pending')
    assert.match(row.last_error, /chat not found/)
    // The error names the chat it tried: "chat not found" alone cannot tell a
    // wrong channel id from a missing grant, and that is the first question.
    assert.match(row.last_error, /@alphalens_ledger/)
  })
})

test('resetFailed re-arms a config failure without touching what did post', async () => {
  await withEnv(CONFIGURED, async () => {
    fakeTelegram({ fail: true })
    const { db, rows, calls } = fakeDb()

    await announce(verdictCall, 'publish', { db })
    assert.equal(rows.get('2:publish').attempts, 1)

    const n = await resetFailed({ db })
    assert.equal(n, 1)
    assert.equal(rows.get('2:publish').attempts, 0)
    assert.equal(rows.get('2:publish').last_error, null)
    // Only unposted rows with a failed attempt are touched — a posted row
    // must never be re-armed, or the channel repeats itself.
    const patch = calls.findLast((c) => c.method === 'PATCH' && c.path.includes('posted_at=is.null'))
    assert.match(patch.path, /attempts=gt\.0/)
  })
})

test('the sweep posts the backlog oldest first — the channel opens in order', async () => {
  await withEnv(CONFIGURED, async () => {
    const sent = fakeTelegram()
    const { db, setPending } = fakeDb()
    // The view already orders by event_at; the sweep must preserve it.
    setPending([
      { call_id: 1, phase: 'publish', event_at: '2026-08-25T13:08:32Z', attempts: 0, call: { ...verdictCall, id: 1 } },
      { call_id: 2, phase: 'publish', event_at: '2026-08-25T13:08:33Z', attempts: 0, call: verdictCall },
      { call_id: 9, phase: 'resolution', event_at: '2026-08-26T00:00:00Z', attempts: 0,
        call: { ...signalCall, outcome: 'incorrect', scored_brier: 0.49 } },
    ])

    const counts = await announceSweep({ db })
    assert.deepEqual(counts, { posted: 3, skipped: 0, failed: 0, unconfigured: 0 })
    assert.deepEqual(sent.map((s) => s.body.text.split('\n')[0]), [
      'Ledger call #1 — hypothesis verdict',
      'Ledger call #2 — hypothesis verdict',
      'Ledger call #9 resolved — INCORRECT',
    ])
  })
})

test('the sweep asks the database for the pending set, bounded and ordered', async () => {
  await withEnv(CONFIGURED, async () => {
    fakeTelegram()
    const { db, calls, setPending } = fakeDb()
    setPending([])
    await announceSweep({ db, limit: 7 })
    const read = calls.find((c) => c.path.startsWith('ledger_telegram_pending'))
    assert.match(read.path, /order=event_at\.asc/)
    assert.match(read.path, /limit=7/)
  })
})
