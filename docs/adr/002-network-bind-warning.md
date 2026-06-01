# ADR-002 — Network bind warning on 0.0.0.0

**Date:** 2026-06-01
**Status:** Accepted

## Context

TallyPrime's XML/HTTP gateway listens on `0.0.0.0` by default — i.e. all network interfaces, not just localhost. There is no built-in authentication. Anyone reachable on the LAN can read or write the company's books.

Verified on 2026-06-01 against a default install (TallyPrime, Windows, ServerPort=9000):

```
TCP    0.0.0.0:9000           0.0.0.0:0              LISTENING       6492
```

Most TallyPrime users are not aware of this. The official help page documents "enable HTTP port 9000" without mentioning the bind address.

## Decision

On `session_start`, pi-tally probes the local bind state. If Tally is bound to `0.0.0.0`, the extension surfaces a **prominent yellow warning** in the TUI footer and the `/tally health` output, with one-click guidance to add a Windows Firewall rule that restricts inbound port 9000 to `127.0.0.1`.

The warning **does not block** operation — many users intentionally allow LAN access (multi-machine offices). But it is shown every session until the user runs `/tally acknowledge-network-risk` or actually restricts the bind.

## Alternatives considered

1. **Block on `0.0.0.0`** — rejected. Too intrusive; breaks legitimate LAN deployments.
2. **Silently ignore** — rejected. Negligent. Defaults that ship credentials-equivalent access on the LAN must be surfaced.
3. **Auto-add firewall rule** — rejected for v1; needs elevation prompt + user understanding. Documented as a v1.1 follow-up via a guided `/tally lock-down` command.

## Consequences

- One more startup check (cheap — single TCP probe).
- Users learn about a real risk they probably didn't know existed.
- pi-tally takes a defensible security posture from day 1.
