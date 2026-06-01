/**
 * Dual audit log — JSONL append-only event stream.
 *
 * Two writers share this module:
 *   1. `commands.ts`   → gate open/close events (operator actions)
 *   2. write tools     → preview/confirm/submit events (v0.2+ — not wired yet)
 *
 * Layout on disk:
 *
 *   ~/.pi-tally/audit/
 *     2026-06.jsonl       human-readable events, one per line
 *     2026-07.jsonl       new file every calendar month
 *     raw/                XML envelopes — written by tools later, not here
 *
 * Design choices:
 *
 * - JSONL (not a DB) — `tail -f`, `grep`, `jq` all just work. Auditors will
 *   read these by hand.
 * - Monthly rotation — keeps any single file small enough to load and bound
 *   the cost of `readAuditEvents`. The next ring up (a CLI `/tally audit
 *   tail`) only needs the current month.
 * - Append-only — we never edit or truncate. Corruption is tolerated by
 *   skipping bad lines on read; a malformed line cannot block a write.
 * - Synchronous fs — audit must complete before the tool returns success.
 *   Volume is low (humans clicking confirm); async batching is premature.
 * - Pure functions take `dir` explicitly. Production callers pass
 *   `auditDir()`; tests pass a tmpdir. No global state.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

/**
 * The set of structured event shapes we currently emit. Add new kinds as
 * new ring/tool callers land — keep them flat (no nested objects) so JSONL
 * stays trivially greppable.
 *
 * Extra fields beyond `id`/`ts`/`kind` are free-form; consumers should
 * treat unknown fields as opaque. We deliberately do NOT enforce a closed
 * union here: the audit log is a write-side concern that should never
 * fail because a tool added a new field.
 */
export interface AuditEvent {
  /** UUID v4 assigned at append time. */
  id: string;
  /** ISO-8601 timestamp (UTC) assigned at append time. */
  ts: string;
  /** Dot-separated event kind, e.g. "gate.opened", "write.confirmed". */
  kind: string;
  /** Arbitrary extra fields. */
  [k: string]: unknown;
}

/** Default audit dir (`~/.pi-tally/audit`). Tests inject a tmpdir instead. */
export function auditDir(): string {
  return join(homedir(), ".pi-tally", "audit");
}

/** Compute the monthly partition file for the given timestamp. */
export function auditFileFor(dir: string, when: Date): string {
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, "0");
  return join(dir, `${y}-${m}.jsonl`);
}

/**
 * Append one event. Returns the persisted record (with the assigned id/ts)
 * so callers can echo the id back to the user for traceability.
 *
 * `when` is injectable so tests can place events into specific months and
 * verify rotation; production callers omit it.
 */
export function appendAuditEvent(
  dir: string,
  partial: Omit<AuditEvent, "id" | "ts"> & { kind: string },
  when: Date = new Date(),
): AuditEvent {
  mkdirSync(dir, { recursive: true });
  const event: AuditEvent = {
    id: randomUUID(),
    ts: when.toISOString(),
    ...partial,
  };
  const file = auditFileFor(dir, when);
  appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
  return event;
}

/**
 * Read all events across all monthly partitions in chronological order.
 *
 * Best-effort: missing dir → []; corrupt lines are silently dropped (we
 * never let audit corruption escalate into a tool failure). The `tail`
 * UX layer can surface "N lines skipped" if needed.
 *
 * Not paginated — current expected volume is < 10k events/month, well
 * within a single read. Revisit if that changes.
 */
export function readAuditEvents(dir: string): AuditEvent[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f))
    .sort(); // lexicographic == chronological for YYYY-MM
  const out: AuditEvent[] = [];
  for (const name of files) {
    const raw = readFileSync(join(dir, name), "utf8");
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object" && typeof parsed.kind === "string") {
          out.push(parsed as AuditEvent);
        }
      } catch {
        // corrupt line — skip silently
      }
    }
  }
  return out;
}
