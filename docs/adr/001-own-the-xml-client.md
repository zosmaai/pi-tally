# ADR-001 — Own the XML client

**Date:** 2026-06-01
**Status:** Accepted

## Context

TallyPrime exposes its functionality only via an XML-over-HTTP gateway (port 9000, default). On Prime 7.0+ the same gateway accepts a JSON-encoded variant of the same envelopes. There is no official REST API, no official SDK, no official client library.

The community has produced several wrappers:

| Project | Lang | Maturity | Notes |
|---|---|---|---|
| `tally-mcp` | Python | medium | 40 tools, MCP server, Python+uv install required |
| `TallyBridge` | Python | medium | Has DuckDB cache pattern worth studying |
| `srinivasan1013/tally-mcp-server` | Python | early | MCP, partial coverage |
| `tallyprime-js-sdk` (`TanmaySawankar390/tally-dev`) | Node | early | JSDoc only, single author, ~3 months old |
| `NoumaanAhamed/tally-prime-api-docs` | Docs | reference | Copy-paste envelope library |

## Decision

Build a tight TypeScript XML client inside pi-tally. **Zero non-Node runtime dependencies.** Reference the docs project and existing wrappers as ground truth for envelope shapes — transcribe, don't invent.

## Alternatives considered

1. **Wrap `tally-mcp` (Python subprocess)** — rejected. Forces every pi-tally user to install Python + uv. Breaks the "single `pi install` and go" distribution promise.
2. **Depend on `tallyprime-js-sdk`** — rejected. One author, three months old, JSDoc not TS, zero community signal. Voucher creation surface incomplete. We'd inherit their bugs and timeline.
3. **Use ODBC** — rejected. Read-only in practice, depends on Windows ODBC drivers, opaque schema, can't create vouchers. Dead-end for our scope.
4. **Wait for Tally Solutions to ship a REST API** — rejected. Hasn't happened in 20 years.

## Consequences

**Positive:**
- Bulletproof distribution: `pi install npm:@zosmaai/pi-tally` is the entire install
- Full TypeScript types, IDE autocomplete on every tool argument
- We can fix bugs same-day instead of waiting for upstream
- Easy to test (fetch mocks, golden fixtures)
- JSON-Prime-7.0 path is a feature flag inside the same client (auto-detect at setup)
- Customers don't ask "which Python should I install?"

**Negative:**
- ~300 LoC of transport + ~200 LoC of envelopes + ~150 LoC of parsing we own forever
- When Tally adds a new field, we update one file. (This is also the upside — the project doesn't drift.)

**Estimated size:**
```
client.ts      ~300 LoC   fetch + retry + auth + JSON-or-XML detect
envelopes.ts   ~200 LoC   pure builders, one per request shape (~12 shapes)
parse.ts       ~150 LoC   XML/JSON → typed objects
types.ts      ~200 LoC   Ledger, Group, Voucher, Report shapes
─────────────────────────
total          ~850 LoC   for the entire Tally protocol layer
```

For reference, `TallyBridge` is ~5,000 LoC and `tally-mcp` is ~6,000. Our layer is smaller because we don't carry MCP boilerplate or Python adapters.
