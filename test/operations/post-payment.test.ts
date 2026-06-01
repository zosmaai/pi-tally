/**
 * postPayment orchestration tests — minimal smoke ensuring it follows
 * the same ring-1+validate+confirm+audit flow as postReceipt and points
 * at the Payment envelope shape.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postPayment } from "../../src/operations/post-payment.js";
import { TallyWriteBlockedError } from "../../src/safety/gates.js";
import { WriteValidationError } from "../../src/operations/validate.js";
import { readAuditEvents } from "../../src/audit/log.js";
import { DEFAULT_CONFIG } from "../../src/config.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-tally-postp-"));
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

function mockClient(responseBody: string, capture?: { last?: string }) {
  const send = vi.fn().mockImplementation(async (env: string) => {
    if (capture) capture.last = env;
    return responseBody;
  });
  return { send } as any;
}

const validInput = {
  company: "Co",
  party: "Acme",
  sourceLedger: "Cash",
  date: "2026-06-01",
  amount: 100,
  narration: "test payment",
};

describe("postPayment", () => {
  it("throws TallyWriteBlockedError when vouchers gate closed (before confirm)", async () => {
    const { ctx, confirm } = mockCtx(true);
    const client = mockClient("");
    await expect(
      postPayment(ctx as any, cfgWithVouchers(false), client, dir, validInput),
    ).rejects.toThrow(TallyWriteBlockedError);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("validates BEFORE confirm", async () => {
    const { ctx, confirm } = mockCtx(true);
    const client = mockClient("");
    await expect(
      postPayment(ctx as any, cfgWithVouchers(true), client, dir, {
        ...validInput,
        amount: -1,
      }),
    ).rejects.toThrow(WriteValidationError);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("submits a Payment envelope (not Receipt) on success", async () => {
    const { ctx } = mockCtx(true);
    const capture: { last?: string } = {};
    const client = mockClient(
      `<RESPONSE><CREATED>1</CREATED><LASTVCHID>9100</LASTVCHID></RESPONSE>`,
      capture,
    );
    const r = await postPayment(ctx as any, cfgWithVouchers(true), client, dir, validInput);
    expect(r.outcome).toBe("submitted");
    expect(r.vchId).toBe("9100");
    expect(capture.last).toMatch(/VCHTYPE="Payment"/);
    expect(capture.last).toContain("<VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>");
    // Party Dr (mirror of receipt)
    expect(capture.last).toMatch(/<LEDGERNAME>Acme<\/LEDGERNAME>[\s\S]*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>[\s\S]*<AMOUNT>-100\.00<\/AMOUNT>/);
  });

  it("preview surfaces 'Pay X to Party from Source' phrasing", async () => {
    const { ctx, confirm } = mockCtx(false);
    const client = mockClient("");
    await postPayment(ctx as any, cfgWithVouchers(true), client, dir, validInput);
    const [, body] = confirm.mock.calls[0]!;
    expect(body).toMatch(/Pay/i);
    expect(body).toContain("Acme");
    expect(body).toContain("Cash");
  });

  it("audit row for decline", async () => {
    const { ctx } = mockCtx(false);
    const client = mockClient("");
    await postPayment(ctx as any, cfgWithVouchers(true), client, dir, validInput);
    const events = readAuditEvents(dir);
    expect(events.some((e) => e.kind === "write.declined" && e.tool === "tally_post_payment")).toBe(
      true,
    );
  });
});
