/**
 * Strategy spec schema + rule grammar v1.
 *
 * A spec is the pre-registration of a hypothesis: what you will trade, on what
 * evidence, with what frictions, over what window, and — stated in advance —
 * what result would kill it. Everything the verifier needs is in here, so a
 * spec_hash identifies a claim exactly.
 *
 * The grammar is deliberately small. Anything outside it is REJECTED with an
 * error that names the offending construct — silently ignoring an unsupported
 * rule would produce a number for a strategy nobody ran.
 *
 * Zero dependencies and zero platform APIs — not even node:crypto. This module
 * runs unchanged in Node (the engine, the enqueue CLI) and in the browser (the
 * /admin console validates a spec before it is submitted). Keep it that way:
 * the hash lives in spec.mjs precisely so this file stays portable, and a
 * second copy of the grammar written for the browser would drift from the one
 * the engine runs, which is the whole thing a spec_hash exists to prevent.
 */

export const SPEC_VERSION = 1

/**
 * Friction floors. See CLAUDE.md: these may never be reduced in any code path.
 * Higher (more pessimistic) values are accepted; lower values are rejected,
 * never clamped. taker_fee_pct is a PERCENT per side (0.045 = 4.5 bps).
 */
export const FRICTION_FLOORS = Object.freeze({
  delay_s: 60,
  slippage_bps: 5,
  taker_fee_pct: 0.045,
})

export const BAR_INTERVALS = Object.freeze(['1m', '5m', '15m', '1h', '4h', '1d'])

const INDICATORS = Object.freeze(['ema', 'rsi', 'price_change_pct'])
const COHORT_METRICS = Object.freeze(['net_flow_usd', 'net_flow_skew', 'new_position_count'])
const TIME_RULES = Object.freeze(['session', 'day_of_week'])
const RULE_TYPES = Object.freeze(['indicator', 'cohort', 'time'])
const COMBINATORS = Object.freeze(['all', 'any', 'not'])

const THRESHOLD_OPS = Object.freeze(['lt', 'lte', 'gt', 'gte', 'cross_above', 'cross_below'])
const EMA_OPS = Object.freeze(['price_above', 'price_below', 'cross_above', 'cross_below'])
const KILL_OPS = Object.freeze(['lt', 'lte', 'gt', 'gte'])

export const KILL_METRICS = Object.freeze([
  'net_pnl_usd', 'win_rate', 'profit_factor', 'max_drawdown_usd', 'max_drawdown_pct',
  'trade_count', 'avg_hold_s', 'worst_month_pnl_usd', 'positive_month_ratio',
])

const DAYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])

export class SpecError extends Error {
  constructor(errors) {
    super(errors.join('; '))
    this.name = 'SpecError'
    this.errors = errors
  }
}

// ── small helpers ───────────────────────────────────────────────────────────

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isStr = (v) => typeof v === 'string' && v.length > 0
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
const list = (xs) => xs.join(', ')

function parseTs(v, path, errors) {
  if (!isStr(v)) { errors.push(`${path}: required ISO-8601 timestamp`); return null }
  const ms = Date.parse(v)
  if (Number.isNaN(ms)) { errors.push(`${path}: "${v}" is not a parseable ISO-8601 timestamp`); return null }
  return ms
}

// ── rule grammar ────────────────────────────────────────────────────────────

/**
 * Validate and normalize one rule node. Pushes human-readable errors that
 * always name the unsupported construct and the path it sits at.
 */
function validateRule(node, path, errors) {
  if (!isObj(node)) {
    errors.push(`${path}: expected a rule object, got ${Array.isArray(node) ? 'array' : typeof node}`)
    return null
  }

  const keys = Object.keys(node)
  const combinator = COMBINATORS.find((c) => keys.includes(c))
  if (combinator) {
    if (keys.length > 1) {
      errors.push(`${path}: combinator "${combinator}" must be the only key (got ${list(keys)})`)
      return null
    }
    if (combinator === 'not') {
      const inner = validateRule(node.not, `${path}.not`, errors)
      return inner ? { not: inner } : null
    }
    const arr = node[combinator]
    if (!Array.isArray(arr) || arr.length === 0) {
      errors.push(`${path}.${combinator}: expected a non-empty array of rules`)
      return null
    }
    const inner = arr.map((r, i) => validateRule(r, `${path}.${combinator}[${i}]`, errors))
    return inner.every(Boolean) ? { [combinator]: inner } : null
  }

  if (!isStr(node.type)) {
    errors.push(`${path}: missing "type" — grammar v1 supports rule types: ${list(RULE_TYPES)} `
      + `and combinators: ${list(COMBINATORS)}`)
    return null
  }
  if (!RULE_TYPES.includes(node.type)) {
    errors.push(`${path}: unsupported rule type "${node.type}" — grammar v1 supports: `
      + `${list(RULE_TYPES)} (plus combinators ${list(COMBINATORS)})`)
    return null
  }

  if (node.type === 'indicator') return validateIndicatorRule(node, path, errors)
  if (node.type === 'cohort') return validateCohortRule(node, path, errors)
  return validateTimeRule(node, path, errors)
}

function validateIndicatorRule(node, path, errors) {
  if (!INDICATORS.includes(node.indicator)) {
    errors.push(`${path}: unsupported indicator "${node.indicator}" — grammar v1 supports: ${list(INDICATORS)}`)
    return null
  }
  const before = errors.length

  if (node.indicator === 'ema') {
    if (!isInt(node.period, 2, 500)) errors.push(`${path}.period: EMA period must be an integer in 2..500`)
    if (!EMA_OPS.includes(node.op)) {
      errors.push(`${path}.op: unsupported op "${node.op}" for ema — supported: ${list(EMA_OPS)} `
        + `(all compare bar close to the EMA)`)
    }
    return errors.length === before
      ? { type: 'indicator', indicator: 'ema', period: node.period, op: node.op }
      : null
  }

  if (node.indicator === 'rsi') {
    if (!isInt(node.period, 2, 500)) errors.push(`${path}.period: RSI period must be an integer in 2..500`)
    if (!THRESHOLD_OPS.includes(node.op)) {
      errors.push(`${path}.op: unsupported op "${node.op}" for rsi — supported: ${list(THRESHOLD_OPS)}`)
    }
    if (!isNum(node.value) || node.value < 0 || node.value > 100) {
      errors.push(`${path}.value: RSI threshold must be a number in 0..100`)
    }
    return errors.length === before
      ? { type: 'indicator', indicator: 'rsi', period: node.period, op: node.op, value: node.value }
      : null
  }

  // price_change_pct: percent change of close over N bars.
  if (!isInt(node.lookback_bars, 1, 5000)) {
    errors.push(`${path}.lookback_bars: price_change_pct lookback must be an integer in 1..5000`)
  }
  if (!THRESHOLD_OPS.includes(node.op)) {
    errors.push(`${path}.op: unsupported op "${node.op}" for price_change_pct — supported: ${list(THRESHOLD_OPS)}`)
  }
  if (!isNum(node.value)) errors.push(`${path}.value: price_change_pct threshold must be a number (percent)`)
  return errors.length === before
    ? {
      type: 'indicator', indicator: 'price_change_pct',
      lookback_bars: node.lookback_bars, op: node.op, value: node.value,
    }
    : null
}

function validateCohortRule(node, path, errors) {
  if (!COHORT_METRICS.includes(node.metric)) {
    errors.push(`${path}: unsupported cohort metric "${node.metric}" — grammar v1 supports: `
      + `${list(COHORT_METRICS)} (the pulse_24h shapes)`)
    return null
  }
  const before = errors.length
  const windowH = node.window_h === undefined ? 24 : node.window_h
  if (!isInt(windowH, 1, 720)) errors.push(`${path}.window_h: must be an integer number of hours in 1..720`)
  if (!THRESHOLD_OPS.includes(node.op)) {
    errors.push(`${path}.op: unsupported op "${node.op}" — supported: ${list(THRESHOLD_OPS)}`)
  }
  if (!isNum(node.value)) errors.push(`${path}.value: must be a number`)

  const out = { type: 'cohort', metric: node.metric, window_h: windowH, op: node.op, value: node.value }

  if (node.metric === 'net_flow_skew' && isNum(node.value) && (node.value < -1 || node.value > 1)) {
    errors.push(`${path}.value: net_flow_skew is net_flow / notional, so the threshold must be in -1..1`)
  }
  if (node.metric === 'new_position_count') {
    const side = node.side === undefined ? 'net' : node.side
    if (!['long', 'short', 'net'].includes(side)) {
      errors.push(`${path}.side: unsupported side "${node.side}" — supported: long, short, net`)
    }
    out.side = side
  } else if (node.side !== undefined) {
    errors.push(`${path}.side: only new_position_count takes a side`)
  }

  return errors.length === before ? out : null
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

function validateTimeRule(node, path, errors) {
  if (!TIME_RULES.includes(node.rule)) {
    errors.push(`${path}: unsupported time rule "${node.rule}" — grammar v1 supports: ${list(TIME_RULES)}`)
    return null
  }
  const before = errors.length
  if (node.rule === 'session') {
    if (!isStr(node.start_utc) || !HHMM.test(node.start_utc)) {
      errors.push(`${path}.start_utc: expected "HH:MM" UTC`)
    }
    if (!isStr(node.end_utc) || !HHMM.test(node.end_utc)) {
      errors.push(`${path}.end_utc: expected "HH:MM" UTC`)
    }
    return errors.length === before
      ? { type: 'time', rule: 'session', start_utc: node.start_utc, end_utc: node.end_utc }
      : null
  }
  if (!Array.isArray(node.days) || node.days.length === 0) {
    errors.push(`${path}.days: expected a non-empty array of ${list(DAYS)}`)
    return null
  }
  const days = node.days.map((d) => (isStr(d) ? d.toLowerCase() : d))
  for (const d of days) {
    if (!DAYS.includes(d)) errors.push(`${path}.days: unsupported day "${d}" — supported: ${list(DAYS)}`)
  }
  return errors.length === before ? { type: 'time', rule: 'day_of_week', days } : null
}

/** Longest warm-up (in bars / hours) any rule in the tree needs before it can be evaluated. */
export function ruleWarmup(rule) {
  const out = { bars: 0, cohortHours: 0, usesCohort: false }
  const walk = (n) => {
    if (!n) return
    if (n.all) return n.all.forEach(walk)
    if (n.any) return n.any.forEach(walk)
    if (n.not) return walk(n.not)
    if (n.type === 'indicator') {
      if (n.indicator === 'ema' || n.indicator === 'rsi') out.bars = Math.max(out.bars, n.period * 3)
      else out.bars = Math.max(out.bars, n.lookback_bars)
    } else if (n.type === 'cohort') {
      out.usesCohort = true
      out.cohortHours = Math.max(out.cohortHours, n.window_h)
    }
  }
  walk(rule)
  // cross_* ops compare against the previous bar, so every rule needs one more.
  out.bars += 1
  return out
}

// ── spec validation ─────────────────────────────────────────────────────────

/**
 * Validate + normalize a strategy spec. Throws SpecError with the full list of
 * problems (not just the first) so a caller can fix a spec in one pass.
 */
export function validateSpec(raw) {
  const errors = []
  if (!isObj(raw)) throw new SpecError(['spec: expected a JSON object'])

  if (raw.spec_version !== SPEC_VERSION) {
    errors.push(`spec_version: unsupported spec_version ${JSON.stringify(raw.spec_version)} — `
      + `this engine implements spec_version ${SPEC_VERSION}`)
  }

  if (!isStr(raw.hypothesis_text) || raw.hypothesis_text.trim().length < 10) {
    errors.push('hypothesis_text: required, and must state the hypothesis in at least 10 characters')
  }

  // universe: coins and/or cohort filters
  const universe = { coins: [], cohort_filters: null }
  if (!isObj(raw.universe)) {
    errors.push('universe: required object with "coins" and/or "cohort_filters"')
  } else {
    if (raw.universe.coins !== undefined) {
      if (!Array.isArray(raw.universe.coins) || raw.universe.coins.some((c) => !isStr(c))) {
        errors.push('universe.coins: expected an array of coin symbols, e.g. ["BTC"]')
      } else {
        universe.coins = raw.universe.coins.map((c) => c.toUpperCase())
      }
    }
    if (raw.universe.cohort_filters !== undefined && raw.universe.cohort_filters !== null) {
      universe.cohort_filters = validateCohortFilters(raw.universe.cohort_filters, errors)
    }
    if (universe.coins.length === 0 && !universe.cohort_filters) {
      errors.push('universe: give explicit coins, cohort_filters, or both — an empty universe verifies nothing')
    }
    if (universe.coins.length > 25) {
      errors.push(`universe.coins: ${universe.coins.length} coins exceeds the 25-coin cap for one job`)
    }
  }

  // entry
  let entry = null
  if (!isObj(raw.entry)) {
    errors.push('entry: required object { side, rule }')
  } else {
    const side = raw.entry.side === undefined ? 'long' : raw.entry.side
    if (!['long', 'short'].includes(side)) {
      errors.push(`entry.side: unsupported side "${raw.entry.side}" — supported: long, short`)
    }
    const rule = validateRule(raw.entry.rule, 'entry.rule', errors)
    entry = { side, rule }
  }

  // exit: condition (optional) + MANDATORY max holding time
  let exit = null
  if (!isObj(raw.exit)) {
    errors.push('exit: required object { condition, max_holding_time_h } — max_holding_time_h is mandatory')
  } else {
    const cond = raw.exit.condition === undefined || raw.exit.condition === null
      ? null
      : validateRule(raw.exit.condition, 'exit.condition', errors)
    if (!isNum(raw.exit.max_holding_time_h) || raw.exit.max_holding_time_h <= 0) {
      errors.push('exit.max_holding_time_h: mandatory positive number of hours — every position must have '
        + 'a time-based exit so no trade can run unbounded')
    }
    if (isNum(raw.exit.max_holding_time_h) && raw.exit.max_holding_time_h > 24 * 365) {
      errors.push('exit.max_holding_time_h: capped at 8760 (one year)')
    }
    exit = { condition: cond, max_holding_time_h: raw.exit.max_holding_time_h }
  }

  // sizing: fixed USD notional only
  let sizing = null
  if (!isObj(raw.sizing)) {
    errors.push('sizing: required object { mode: "fixed_usd", notional_usd }')
  } else {
    if (raw.sizing.mode !== undefined && raw.sizing.mode !== 'fixed_usd') {
      errors.push(`sizing.mode: unsupported sizing mode "${raw.sizing.mode}" — v1 supports: fixed_usd `
        + `(no compounding, no leverage scaling)`)
    }
    if (!isNum(raw.sizing.notional_usd) || raw.sizing.notional_usd <= 0) {
      errors.push('sizing.notional_usd: required positive USD notional per position')
    }
    sizing = { mode: 'fixed_usd', notional_usd: raw.sizing.notional_usd }
  }

  // frictions: floors enforced here, higher allowed, lower rejected
  const frictions = validateFrictions(raw.frictions, errors)

  // window
  let windowSpec = null
  if (!isObj(raw.window)) {
    errors.push('window: required object { start, end } (ISO-8601)')
  } else {
    const start = parseTs(raw.window.start, 'window.start', errors)
    const end = parseTs(raw.window.end, 'window.end', errors)
    if (start !== null && end !== null && end <= start) {
      errors.push('window: end must be after start')
    }
    windowSpec = {
      start: start !== null ? new Date(start).toISOString() : raw.window.start,
      end: end !== null ? new Date(end).toISOString() : raw.window.end,
    }
  }

  // bar interval (the evaluation grid)
  const barInterval = raw.bar_interval === undefined ? '1h' : raw.bar_interval
  if (!BAR_INTERVALS.includes(barInterval)) {
    errors.push(`bar_interval: unsupported interval "${raw.bar_interval}" — supported: ${list(BAR_INTERVALS)}`)
  }

  // kill criteria: pre-registered, at least one
  const killCriteria = validateKillCriteria(raw.kill_criteria, errors)

  // notes: look-ahead flags + mechanism
  const notes = validateNotes(raw.notes, errors)

  if (errors.length) throw new SpecError(errors)

  return {
    spec_version: SPEC_VERSION,
    hypothesis_text: raw.hypothesis_text.trim(),
    universe,
    entry,
    exit,
    sizing,
    frictions,
    window: windowSpec,
    bar_interval: barInterval,
    kill_criteria: killCriteria,
    notes,
  }
}

function validateCohortFilters(f, errors) {
  if (!isObj(f)) {
    errors.push('universe.cohort_filters: expected an object')
    return null
  }
  const out = {}
  const allowed = ['archetypes', 'min_sharpe_30d', 'max_trade_count_30d', 'min_win_rate', 'top_n_coins_by_notional', 'max_wallets']
  for (const k of Object.keys(f)) {
    if (!allowed.includes(k)) {
      errors.push(`universe.cohort_filters.${k}: unsupported filter — supported: ${list(allowed)}`)
    }
  }
  if (f.archetypes !== undefined) {
    if (!Array.isArray(f.archetypes) || f.archetypes.some((a) => !isStr(a))) {
      errors.push('universe.cohort_filters.archetypes: expected an array of archetype names')
    } else out.archetypes = f.archetypes
  }
  for (const k of ['min_sharpe_30d', 'max_trade_count_30d', 'min_win_rate']) {
    if (f[k] !== undefined) {
      if (!isNum(f[k])) errors.push(`universe.cohort_filters.${k}: expected a number`)
      else out[k] = f[k]
    }
  }
  if (f.top_n_coins_by_notional !== undefined) {
    if (!isInt(f.top_n_coins_by_notional, 1, 25)) {
      errors.push('universe.cohort_filters.top_n_coins_by_notional: expected an integer in 1..25')
    } else out.top_n_coins_by_notional = f.top_n_coins_by_notional
  }
  if (f.max_wallets !== undefined) {
    if (!isInt(f.max_wallets, 1, 5000)) errors.push('universe.cohort_filters.max_wallets: expected an integer in 1..5000')
    else out.max_wallets = f.max_wallets
  }
  return out
}

function validateFrictions(f, errors) {
  if (!isObj(f)) {
    errors.push('frictions: required object { delay_s, slippage_bps, taker_fee_pct } — the floors are '
      + `${FRICTION_FLOORS.delay_s}s / ${FRICTION_FLOORS.slippage_bps}bps / ${FRICTION_FLOORS.taker_fee_pct}% per side`)
    return null
  }
  const out = {}
  for (const [key, floor] of Object.entries(FRICTION_FLOORS)) {
    const v = f[key]
    if (!isNum(v)) {
      errors.push(`frictions.${key}: required number (floor ${floor})`)
      continue
    }
    if (v < floor) {
      errors.push(`frictions.${key}: ${v} is below the ${floor} floor and is rejected, not clamped — `
        + 'the friction floors may never be reduced in any code path (see CLAUDE.md)')
      continue
    }
    out[key] = v
  }
  return out
}

function validateKillCriteria(raw, errors) {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('kill_criteria: required non-empty array of pre-registered conditions — a hypothesis with '
      + 'no falsifier is not verifiable')
    return []
  }
  const seen = new Set()
  const out = []
  raw.forEach((c, i) => {
    const path = `kill_criteria[${i}]`
    if (!isObj(c)) { errors.push(`${path}: expected an object`); return }
    if (!isStr(c.id)) errors.push(`${path}.id: required stable identifier`)
    else if (seen.has(c.id)) errors.push(`${path}.id: duplicate criterion id "${c.id}"`)
    else seen.add(c.id)
    if (!KILL_METRICS.includes(c.metric)) {
      errors.push(`${path}.metric: unsupported metric "${c.metric}" — supported: ${list(KILL_METRICS)}`)
    }
    if (!KILL_OPS.includes(c.op)) {
      errors.push(`${path}.op: unsupported op "${c.op}" — supported: ${list(KILL_OPS)}`)
    }
    if (!isNum(c.value)) errors.push(`${path}.value: required number`)
    out.push({
      id: c.id,
      metric: c.metric,
      op: c.op,
      value: c.value,
      description: isStr(c.description) ? c.description : null,
    })
  })
  return out
}

function validateNotes(raw, errors) {
  if (!isObj(raw)) {
    errors.push('notes: required object { look_ahead_flags: [...], mechanism: "stated"|"pattern_based", '
      + 'mechanism_text? } — the honesty disclosures are part of the spec, not an afterthought')
    return null
  }
  const flags = raw.look_ahead_flags
  if (!Array.isArray(flags) || flags.some((f) => !isStr(f))) {
    errors.push('notes.look_ahead_flags: expected an array of strings (use [] to assert none are known)')
  }
  if (!['stated', 'pattern_based'].includes(raw.mechanism)) {
    errors.push(`notes.mechanism: unsupported value "${raw.mechanism}" — must be "stated" (you can say why `
      + 'this should work) or "pattern_based" (you cannot, and the result must be read accordingly)')
  }
  if (raw.mechanism === 'stated' && !isStr(raw.mechanism_text)) {
    errors.push('notes.mechanism_text: required when mechanism is "stated" — state the mechanism')
  }
  return {
    look_ahead_flags: Array.isArray(flags) ? flags : [],
    mechanism: raw.mechanism,
    mechanism_text: isStr(raw.mechanism_text) ? raw.mechanism_text : null,
  }
}

// ── canonical form ──────────────────────────────────────────────────────────

/** Deterministic JSON: object keys sorted recursively. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value === undefined ? null : value)
}
