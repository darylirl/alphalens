# alphalens-mcp-server

<!-- mcp-name: io.github.darylirl/alphalens-mcp-server -->

**Read-only MCP tools over the AlphaLens public API.** Four tools, no auth, no
writes, no database access.

AlphaLens is a verification-first trading research project on Hyperliquid: it
captures real wallet activity, classifies the traders behind it, and turns
trading hypotheses into pre-registered, frictioned, immutable verdicts. This
server exposes what AlphaLens *publishes* to agents that speak MCP — the public
Ledger, the aggregate positioning of the tracked cohort, and the cohort itself.

Nothing it serves is financial advice. Every tool response carries that notice
in a top-level `notice` field, so it travels with the data rather than sitting
on a page the agent never sees.

---

## Architecture: this is a client of the public API

Every tool reads through the same public HTTP endpoints a human can `curl`:

| Tool | Endpoint |
| --- | --- |
| `alphalens_get_pulse` | `GET /api/pulse` |
| `alphalens_list_ledger_calls` | `GET /api/ledger/calls` |
| `alphalens_get_ledger_call` | `GET /api/ledger/calls/{id}` |
| `alphalens_get_cohort` | `GET /api/cohort` |

There is **no database client in this service and there must never be one.**
The app and this server are both clients of the same public API. That is the
standing architecture rule, and it is load-bearing in two directions: whatever
an agent is told here, anyone can re-fetch and check by hand, and the database's
connection budget stays with the services that genuinely need it (the capture
daemon and the verification engine, which do not tolerate being crowded out by
a read that could have gone over HTTP).

`ALPHALENS_API_BASE` selects the deployment to read; it defaults to
`https://alphalens-taupe.vercel.app`.

## The response envelope

Every tool returns the same shape:

```jsonc
{
  "data":     { /* the answer; absent measurements are null, never zero */ },
  "coverage": { /* what was actually measured: freshness, counts, completeness */ },
  "caveats":  [ /* the specific things a reader would otherwise get wrong */ ],
  "source":   "https://alphalens-taupe.vercel.app/api/pulse",
  "notice":   "Nothing served by AlphaLens is financial advice…"
}
```

It is returned as `structuredContent` and mirrored verbatim as JSON text
content, so clients without structured-output support see the same payload
rather than a summary of it.

`coverage` is not decoration. A gap in captured data is the absence of a
measurement, not a reading of zero, and the two are opposite claims. So:

- `/api/pulse` degrades to an empty list on a failed read. When that happens
  `coverage.status` is `"unavailable"` and the first caveat says so explicitly —
  an empty aggregate is never handed over as "the cohort is flat".
- A `503` from any endpoint surfaces as a tool error, never as an empty answer.
- Null stays null. A null `long_pct_change` means "no baseline to compare
  against", and a null `trade_count_30d` means "never sampled".
- An `unresolvable` Ledger outcome means captured tape had a gap at a decision
  instant, so no price was guessed and no Brier score was assigned.

## Tools

### `alphalens_get_pulse`

Current aggregate positioning of the tracked cohort per coin over a rolling 24
hours: traded notional, net flow, long/short skew, new positions, active wallet
counts. No parameters. Coverage reports whether capture is live, when it
started, its last heartbeat, and when the aggregate was last computed.

### `alphalens_list_ledger_calls`

Paginated Ledger calls, newest first, with outcomes.

| Param | Type | Notes |
| --- | --- | --- |
| `kind` | `"hypothesis_verdict"` \| `"cohort_signal"` | Optional. Omit for both. |
| `limit` | integer 1–200 | Optional; upstream default 50. |
| `cursor` | string | Optional; pass back `data.next_cursor`. |

The Ledger is append-only by database enforcement — losing and unresolvable
calls are in the list, because a track record that omits them is not one.

### `alphalens_get_ledger_call`

One call by numeric `id`, with full provenance: engine version, job id, spec
hash, claim, horizon, and — once resolved — outcome, Brier score and resolution
evidence.

### `alphalens_get_cohort`

The tracked cohort: total count, breakdown by behavioral archetype, the
selection criteria that put a wallet in capture scope, and the CSV download URL
with its SHA-256 so the list can be audited independently. Set
`include_wallets: true` to page through the addresses (`limit` 1–500, `cursor`).

`count` and `by_archetype` describe the whole cohort; `wallets` is one bounded
page of it.

---

## Connecting

### Claude Desktop

Edit the config file:

- macOS — `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows — `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "alphalens": {
      "command": "node",
      "args": ["/absolute/path/to/alphalens/mcp-service/index.mjs"]
    }
  }
}
```

Restart Claude Desktop. The four tools appear under the tools menu. To read a
deployment other than production, add an `env` block:

```json
{
  "mcpServers": {
    "alphalens": {
      "command": "node",
      "args": ["/absolute/path/to/alphalens/mcp-service/index.mjs"],
      "env": { "ALPHALENS_API_BASE": "https://your-deployment.example" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add alphalens -- node /absolute/path/to/alphalens/mcp-service/index.mjs
```

### Any MCP client (stdio)

Launch `node mcp-service/index.mjs` as a subprocess and speak
newline-delimited JSON-RPC 2.0 over its stdin/stdout. Requires Node 22+. No
install step — the server has zero dependencies.

The server is dual-era in the specification's terms: it answers the
`initialize` handshake that clients through revision `2025-11-25` expect, and
it answers `server/discover` with per-request `_meta` version negotiation for
`2026-07-28` and later. A request declaring a revision the server does not
implement gets an `UnsupportedProtocolVersionError` (`-32022`) listing the ones
it does.

```bash
# a one-line handshake, by hand
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-service/index.mjs
```

### Docker

```bash
docker build -t alphalens-mcp mcp-service/
docker run -i --rm alphalens-mcp
```

`-i` matters: the transport is stdin/stdout.

---

## Development

```bash
node --test 'mcp-service/test/*.test.mjs'   # unit tests, offline, stubbed HTTP
node mcp-service/smoke.mjs                  # end-to-end against production
```

`smoke.mjs` launches the server as a real subprocess, completes the handshake,
and calls all four tools against a live deployment (production by default;
override with `ALPHALENS_API_BASE`). It asserts the invariants that make a
number trustworthy — the envelope is present, coverage is stated, the notice is
attached, an empty aggregate is labelled as an outage — rather than asserting
particular values, since the values are whatever was really measured.

It exits non-zero if any check fails, and prints the failures.

## Deployment

Not deployed by this repository. The `Dockerfile` matches the conventions of
`capture-service/` and `verify-service/`: Node 22 slim, no install step,
non-root, source copied in. Hosting is handled outside this repo.
