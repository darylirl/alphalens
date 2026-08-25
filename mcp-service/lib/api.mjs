/**
 * The only way this service reaches AlphaLens data: the public HTTP API.
 *
 * There is no database client here and there must never be one. The app and
 * this MCP server are both clients of the same public endpoints, which is what
 * keeps the read surface honest (whatever an agent sees, a human can fetch
 * with curl) and keeps the database's connection budget for the services that
 * genuinely need it.
 */

export const DEFAULT_BASE = 'https://alphalens-taupe.vercel.app'

/** Read the base URL once, normalized without a trailing slash. */
export function apiBase(env = process.env) {
  const raw = (env.ALPHALENS_API_BASE || DEFAULT_BASE).trim()
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

const DEFAULT_TIMEOUT_MS = 15_000

/** An upstream failure that carries the status and the URL that produced it,
 * so a tool error can tell an agent what to try instead of "request failed". */
export class ApiError extends Error {
  constructor(message, { status = null, url = null, hint = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.url = url
    this.hint = hint
  }
}

export function buildUrl(path, params = {}, env = process.env) {
  const url = new URL(path, apiBase(env) + '/')
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    url.searchParams.set(k, String(v))
  }
  return url.toString()
}

/**
 * GET one public endpoint as JSON. Every non-2xx is an ApiError — including
 * 503, which the app returns when a database read fails. That distinction
 * matters: a 503 means "not measured right now", never "the answer is empty".
 */
export async function getJson(path, params = {}, { env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const url = buildUrl(path, params, env)

  let res
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'alphalens-mcp-server' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    throw new ApiError(
      timedOut ? `request to ${url} timed out after ${timeoutMs}ms` : `could not reach ${url}: ${err?.message ?? err}`,
      { url, hint: 'Check network reachability of the AlphaLens API, or set ALPHALENS_API_BASE to a reachable deployment.' }
    )
  }

  const body = await res.text()
  let parsed = null
  try {
    parsed = body ? JSON.parse(body) : null
  } catch {
    parsed = null
  }

  if (!res.ok) {
    const detail = typeof parsed?.error === 'string' ? parsed.error : body.slice(0, 200).trim()
    throw new ApiError(`${url} returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`, {
      status: res.status,
      url,
      hint: hintForStatus(res.status),
    })
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new ApiError(`${url} returned a non-JSON body`, {
      status: res.status,
      url,
      hint: 'The endpoint may be served by an older deployment. Confirm the base URL points at a build that includes this endpoint.',
    })
  }

  return parsed
}

function hintForStatus(status) {
  if (status === 400) return 'The request parameters were rejected. Re-read the tool schema and retry with valid values.'
  if (status === 404) return 'No such resource at this deployment. For a Ledger call, list calls first and use an id from that list.'
  if (status === 503) return 'AlphaLens could not read its database just now. This is an outage, not an empty result — do not treat it as "no data". Retry later.'
  if (status >= 500) return 'Upstream error at the AlphaLens deployment. Retry later; do not infer anything about the data from this.'
  return null
}
