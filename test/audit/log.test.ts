/**
 * Audit log — JSONL append-only event stream.
 *
 * Contract:
 *   - Events serialize as one JSON object per line, append-only
 *   - File path partitions by event timestamp month: YYYY-MM.jsonl
 *   - Directory is created lazily
 *   - Every event carries id (uuid v4), ts (ISO), kind, and payload
 *   - Reading back is best-effort streaming; corrupt lines are skipped, not
 *     fatal (we never let a corrupt audit log break Tally writes)
 *
 * Path layout (production):
 *   ~/.pi-tally/audit/2026-06.jsonl
 *
 * For tests, the dir is injected so we can use a tmpdir.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendAuditEvent,
  readAuditEvents,
  auditFileFor,
  type AuditEvent,
} from "../../src/audit/log.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-tally-audit-"));
});

describe("appendAuditEvent", () => {
  it("creates the audit dir lazily and writes one JSON line", () => {
    const ev = appendAuditEvent(dir, { kind: "gate.opened", category: "vouchers", actor: "user" });
    const file = auditFileFor(dir, new Date(ev.ts));
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.kind).toBe("gate.opened");
    expect(parsed.category).toBe("vouchers");
    expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("appends sequentially without truncating prior events", () => {
    appendAuditEvent(dir, { kind: "gate.opened", category: "vouchers" });
    appendAuditEvent(dir, { kind: "gate.closed", category: "vouchers" });
    appendAuditEvent(dir, { kind: "write.confirmed", tool: "tally_post_receipt" });
    const events = readAuditEvents(dir);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind)).toEqual([
      "gate.opened",
      "gate.closed",
      "write.confirmed",
    ]);
  });

  it("partitions events into YYYY-MM.jsonl by timestamp", () => {
    const ev = appendAuditEvent(dir, { kind: "gate.opened" }, new Date("2026-03-15T10:00:00Z"));
    const file = auditFileFor(dir, new Date(ev.ts));
    expect(file).toBe(join(dir, "2026-03.jsonl"));
    // Different month → different file
    appendAuditEvent(dir, { kind: "gate.closed" }, new Date("2026-04-01T00:00:00Z"));
    expect(existsSync(join(dir, "2026-04.jsonl"))).toBe(true);
  });

  it("assigns a fresh uuid per event", () => {
    const a = appendAuditEvent(dir, { kind: "x" });
    const b = appendAuditEvent(dir, { kind: "x" });
    expect(a.id).not.toBe(b.id);
  });

  it("returns the same record that was persisted", () => {
    const ev = appendAuditEvent(dir, { kind: "write.confirmed", tool: "tally_post_receipt" });
    const onDisk = readAuditEvents(dir).find((e) => e.id === ev.id);
    expect(onDisk).toEqual(ev);
  });
});

describe("readAuditEvents", () => {
  it("returns [] when the dir does not exist", () => {
    expect(readAuditEvents(join(dir, "does-not-exist"))).toEqual([]);
  });

  it("returns [] when no .jsonl files have been written yet", () => {
    expect(readAuditEvents(dir)).toEqual([]);
  });

  it("skips corrupt lines instead of throwing", () => {
    // Plant a file with one good event and one garbage line
    const good: AuditEvent = {
      id: "11111111-1111-4111-8111-111111111111",
      ts: "2026-06-01T00:00:00.000Z",
      kind: "gate.opened",
    };
    writeFileSync(
      join(dir, "2026-06.jsonl"),
      JSON.stringify(good) + "\n{not json at all}\n",
      "utf8",
    );
    const events = readAuditEvents(dir);
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe(good.id);
  });

  it("reads events across multiple month files in chronological order", () => {
    appendAuditEvent(dir, { kind: "first" }, new Date("2026-03-01T00:00:00Z"));
    appendAuditEvent(dir, { kind: "second" }, new Date("2026-04-15T00:00:00Z"));
    appendAuditEvent(dir, { kind: "third" }, new Date("2026-05-30T00:00:00Z"));
    const events = readAuditEvents(dir);
    expect(events.map((e) => e.kind)).toEqual(["first", "second", "third"]);
  });
});
