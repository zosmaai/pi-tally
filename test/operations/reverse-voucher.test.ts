/**
 * reverseVoucher — thin wrapper that posts a Payment voucher to undo
 * a previously-posted Receipt (or vice-versa for a Receipt-to-undo-Payment).
 *
 * Why a wrapper, not a new envelope: TallyPrime's XML gateway cannot
 * truly delete vouchers without UI-level "Allow Deletion" permission
 * (see memex card `tally-xml-cannot-truly-delete-vouchers`). The
 * production-grade fix is to post an offsetting voucher with a
 * narration linking back to the original — the textbook reversal entry.
 *
 * v0.2 scope: only Receipt → Payment reversal (most common). Other
 * directions (Payment → Receipt, Journal → Journal) land in v0.3 with
 * the cancellation HTN tree.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reverseReceiptVoucher } from "../../src/operations/reverse-voucher.js";
import { TallyWriteBlockedError } from "../../src/safety/gates.js";
import { readAuditEvents } from "../../src/audit/log.js";
import { DEFAULT_CONFIG } from "../../src/config.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-tally-rev-"));
});

function cfgWithVouchers(open: boolean) {
  return {
    ...DEFAULT_CONFIG,
    writeGates: { ...DEFAULT_CONFIG.writeGates, vouchers: open },
  };
}

function mockCtx(answer: boolean) {
  const confirm = vi.fn().mockResolvedValue(answer);
  return {
    ctx: { ui: { confirm, notify: vi.fn(), select: vi.fn() } },
    confirm,
  };
}

function mockClient(body: string, capture?: { last?: string }) {
  const send = vi.fn().mockImplementation(async (env: string) => {
    if (capture) capture.last = env;
    return body;
  });
  return { send } as any;
}

const validInput = {
  company: "Co",
  party: "Acme",
  /** Bank/Cash ledger that the original receipt credited. Becomes the source of the reversal payment. */
  destinationLedger: "Cash",
  date: "2026-06-01",
  amount: 100,
  originalVoucherRef: "RV/2026/2",
};

describe("reverseReceiptVoucher", () => {
  it("requires the vouchers gate", async () => {
    const { ctx } = mockCtx(true);
    await expect(
      reverseReceiptVoucher(ctx as any, cfgWithVouchers(false), mockClient(""), dir, validInput),
    ).rejects.toThrow(TallyWriteBlockedError);
  });

  it("emits a Payment voucher mirroring the receipt sides", async () => {
    const { ctx } = mockCtx(true);
    const capture: { last?: string } = {};
    const client = mockClient(
      `<RESPONSE><CREATED>1</CREATED><LASTVCHID>9500</LASTVCHID></RESPONSE>`,
      capture,
    );
    const r = await reverseReceiptVoucher(
      ctx as any,
      cfgWithVouchers(true),
      client,
      dir,
      validInput,
    );
    expect(r.outcome).toBe("submitted");
    expect(r.vchId).toBe("9500");
    expect(capture.last).toMatch(/VCHTYPE="Payment"/);
    // Original-voucher ref appears in the narration for audit trail
    expect(capture.last).toContain("RV/2026/2");
    expect(capture.last).toMatch(/REVERSAL/i);
  });

  it("preview clearly labels the operation as a reversal", async () => {
    const { ctx, confirm } = mockCtx(false);
    await reverseReceiptVoucher(
      ctx as any,
      cfgWithVouchers(true),
      mockClient(""),
      dir,
      validInput,
    );
    const [title, body] = confirm.mock.calls[0]!;
    expect(title).toMatch(/Reverse|Reversal/i);
    expect(body).toContain("RV/2026/2");
  });

  it("audit row uses tally_reverse_voucher tool name", async () => {
    const { ctx } = mockCtx(false);
    await reverseReceiptVoucher(
      ctx as any,
      cfgWithVouchers(true),
      mockClient(""),
      dir,
      validInput,
    );
    const events = readAuditEvents(dir);
    expect(
      events.some((e) => e.kind === "write.declined" && e.tool === "tally_reverse_voucher"),
    ).toBe(true);
  });
});
