/**
 * Ledger → public Telegram channel.
 *
 * Deliberately SEPARATE from the watchdog alert bot: alerts are operational
 * (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, private), the Ledger channel is
 * content (LEDGER_TELEGRAM_BOT_TOKEN + LEDGER_TELEGRAM_CHANNEL_ID, public).
 * Reusing the alert chat would mix the two audiences and leak one into the
 * other, so this module refuses to fall back to the alert env vars.
 *
 * Stubbed behind env presence: unconfigured is a normal state, not an error —
 * the message is logged and dropped. No secrets in code, ever.
 */

const APP_URL = (
  process.env.LEDGER_PUBLIC_URL
  || process.env.NEXT_PUBLIC_APP_URL
  || 'https://alphalens-taupe.vercel.app'
).replace(/\/$/, '')

export function ledgerTelegramConfigured() {
  return Boolean(process.env.LEDGER_TELEGRAM_BOT_TOKEN && process.env.LEDGER_TELEGRAM_CHANNEL_ID)
}

async function send(text, { log = () => {} } = {}) {
  if (!ledgerTelegramConfigured()) {
    log(`ledger telegram unconfigured — not posting: ${text.split('\n')[0]}`)
    return false
  }
  const token = process.env.LEDGER_TELEGRAM_BOT_TOKEN
  const chat = process.env.LEDGER_TELEGRAM_CHANNEL_ID
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: false }),
  })
  if (!res.ok) throw new Error(`telegram sendMessage: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return true
}

const pct = (p) => `${Math.round(p * 100)}%`

/** Message for a freshly published call. Pure, exported for tests. */
export function formatCall(call) {
  const link = `${APP_URL}/ledger/${call.id}`
  if (call.kind === 'hypothesis_verdict') {
    const v = call.subject?.verdict === 'killed' ? '🪦 KILLED' : '✅ SURVIVED'
    return `${v} — hypothesis verdict #${call.id}\n\n${call.claim}\n\n${link}`
  }
  return (
    `📣 New call #${call.id} — ${pct(Number(call.confidence))} confidence\n\n${call.claim}\n\n`
    + `Resolves ${new Date(call.resolves_at).toISOString().slice(0, 16)}Z against captured tape.\n${link}`
  )
}

/** Message for a scored resolution. Pure, exported for tests. */
export function formatResolution(call) {
  const link = `${APP_URL}/ledger/${call.id}`
  const badge = { correct: '🎯 CORRECT', incorrect: '❌ INCORRECT', unresolvable: '⛔ UNRESOLVABLE (data gap)' }[call.outcome]
    || call.outcome
  const brier = call.scored_brier === null || call.scored_brier === undefined
    ? ''
    : `\nBrier score: ${Number(call.scored_brier).toFixed(3)} (0 = perfect, 1 = maximally wrong)`
  return `${badge} — call #${call.id} resolved\n\n${call.claim}${brier}\n\n${link}`
}

export async function announceCall(call, opts) {
  return send(formatCall(call), opts)
}

export async function announceResolution(call, opts) {
  return send(formatResolution(call), opts)
}
