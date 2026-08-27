import type { Notification } from './checks'

/**
 * Telegram delivery for the external monitor.
 *
 * Reuses the operational watchdog bot the capture daemon already alerts
 * through (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) so alerts land in the chat
 * that is already being watched. The prefix differs — `[alphalens-monitor]`
 * against the daemon's `[alphalens-capture]` — because the whole point is
 * that you can tell which of the two is still able to speak.
 *
 * Deliberately NOT the Ledger bot (LEDGER_TELEGRAM_*): that channel is public
 * content, this one is private operations.
 */

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'unknown'
  const total = Math.floor(ms / 1000)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${total}s`
}

/**
 * Alert text. Pure — exported so the wording can be checked without sending
 * anything. Never claims a timestamp it does not have: an unmeasurable stream
 * says so rather than printing a plausible-looking age.
 */
export function formatMessage(n: Notification, checkedAt: string): string {
  const { verdict: v, incident } = n
  const lines: string[] = []

  if (n.kind === 'recovery') {
    const downFor = formatDuration(Date.parse(checkedAt) - Date.parse(incident.openedAt))
    lines.push(`🟢 RECOVERED — ${v.label}`)
    lines.push('')
    lines.push(`Fresh again after ${downFor} down.`)
    lines.push(`Latest: ${v.seenAt ?? 'unknown'}`)
    lines.push(`Incident opened: ${incident.openedAt}`)
  } else {
    const head = n.kind === 'reminder' ? '🔴 STILL DOWN' : '🔴 ALERT'
    if (v.status === 'unknown') {
      lines.push(`${head} — ${v.label}: cannot be measured`)
      lines.push('')
      lines.push(v.readError
        ? `Read failed: ${v.readError}`
        : 'The read succeeded but returned no rows — there is no beat on record.')
      lines.push('This is an absence of measurement, not a healthy stream.')
    } else {
      lines.push(`${head} — ${v.label} is silent`)
      lines.push('')
      lines.push(`Silent for: ${formatDuration(v.silentForMs)}`)
      lines.push(`Last beat:  ${v.seenAt ?? 'unknown'}`)
    }
    // Only a measured stream has a threshold to have crossed; printing one
    // next to "cannot be measured" invites the reader to treat the absence
    // as a reading.
    if (v.status === 'stale') {
      lines.push(`Threshold:  ${formatDuration(v.thresholdMs)} (${v.rationale})`)
    }
    lines.push(`Source:     ${v.source}`)
    if (n.kind === 'reminder') lines.push(`Down since: ${incident.openedAt}`)
  }

  lines.push('')
  lines.push(`Checked ${checkedAt} by the external monitor (/api/monitor/heartbeats).`)
  return `[alphalens-monitor] ${lines.join('\n')}`
}

export interface SendResult {
  delivered: boolean
  /** Telegram's message id when it accepted the send. */
  messageId?: number
  error?: string
}

/**
 * Send one message. An unconfigured bot is a normal state, not a crash: the
 * result says `delivered: false` with the reason, and the route surfaces it,
 * so nobody reads a 200 as proof an alert went out.
 */
export async function sendTelegram(text: string): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) {
    return { delivered: false, error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set' }
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      cache: 'no-store',
    })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body?.ok) {
      return {
        delivered: false,
        error: `telegram ${res.status}: ${body?.description ?? 'no response body'}`,
      }
    }
    return { delivered: true, messageId: body.result?.message_id }
  } catch (e) {
    return { delivered: false, error: e instanceof Error ? e.message : String(e) }
  }
}
