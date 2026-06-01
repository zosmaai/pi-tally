/**
 * Ring 2 — pre-submit confirmation panel.
 *
 * Contract (stub level; full pi-tui rendering ships when first write tool lands):
 *
 *   confirmWrite(ctx, preview, auditDir) →
 *     - renders preview lines via ctx.ui.confirm (yes/no modal)
 *     - returns { accepted: boolean }
 *     - on accept → audit event { kind: "write.confirmed", tool, summary }
 *     - on decline → audit event { kind: "write.declined", tool, summary }
 *     - the audit row is written BEFORE the function returns so a crashed
 *       caller still leaves a trace of the human decision
 *     - preview body is built from structured WritePreview fields, never
 *       from a free-text LLM-supplied string (Ring 4 in spirit)
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirmWrite, renderPreview, type WritePreview } from "../../src/ui/confirm.js";
import { readAuditEvents } from "../../src/audit/log.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-tally-confirm-"));
});

function mockCtx(answer: boolean) {
  const confirm = vi.fn().mockResolvedValue(answer);
  const notify = vi.fn();
  return {
    ctx: { ui: { confirm, notify, select: vi.fn() } },
    confirm,
    notify,
  };
}

const samplePreview: WritePreview = {
  tool: "tally_post_receipt",
  title: "Post Receipt",
  summary: "₹50,000 from Acme Pvt Ltd into HDFC Current A/c on 31-May-2026",
  fields: [
    ["Date", "31-May-2026"],
    ["Party", "Acme Pvt Ltd"],
    ["Amount", "₹50,000.00"],
    ["Destination", "HDFC Current A/c"],
    ["Bill ref", "Agst INV-2025-014"],
  ],
};

describe("renderPreview", () => {
  it("includes title, summary, every field, and never raw XML markers", () => {
    const body = renderPreview(samplePreview);
    expect(body).toContain("Post Receipt");
    expect(body).toContain("₹50,000");
    expect(body).toContain("Acme Pvt Ltd");
    expect(body).toContain("HDFC Current A/c");
    for (const [k, v] of samplePreview.fields) {
      expect(body).toContain(k);
      expect(body).toContain(v);
    }
    // The preview must NEVER show raw XML to the user
    expect(body).not.toMatch(/<ENVELOPE>|<VOUCHER>|<LEDGERENTRIES/);
  });

  it("renders preview deterministically (same input → same output)", () => {
    expect(renderPreview(samplePreview)).toBe(renderPreview(samplePreview));
  });
});

describe("confirmWrite", () => {
  it("returns accepted=true when the user confirms", async () => {
    const { ctx, confirm } = mockCtx(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await confirmWrite(ctx as any, samplePreview, dir);
    expect(result.accepted).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    const [title, body] = confirm.mock.calls[0]!;
    expect(title).toBe("Post Receipt");
    expect(body).toContain("Acme Pvt Ltd");
  });

  it("returns accepted=false when the user declines", async () => {
    const { ctx } = mockCtx(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await confirmWrite(ctx as any, samplePreview, dir);
    expect(result.accepted).toBe(false);
  });

  it("writes a write.confirmed audit event on accept", async () => {
    const { ctx } = mockCtx(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await confirmWrite(ctx as any, samplePreview, dir);
    const events = readAuditEvents(dir);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("write.confirmed");
    expect(events[0]!.tool).toBe("tally_post_receipt");
    expect(events[0]!.summary).toBe(samplePreview.summary);
  });

  it("writes a write.declined audit event on cancel", async () => {
    const { ctx } = mockCtx(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await confirmWrite(ctx as any, samplePreview, dir);
    const events = readAuditEvents(dir);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("write.declined");
    expect(events[0]!.tool).toBe("tally_post_receipt");
  });

  it("audit fires even when the user declines (no silent skips)", async () => {
    const { ctx } = mockCtx(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await confirmWrite(ctx as any, samplePreview, dir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await confirmWrite(ctx as any, samplePreview, dir);
    expect(readAuditEvents(dir)).toHaveLength(2);
  });
});
