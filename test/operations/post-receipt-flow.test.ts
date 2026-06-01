/**
 * postReceipt orchestration tests (full flow, mocked client).
 *
 * Covers the contract guarantees the LLM-facing tool will rely on:
 *   - Gate closed → throw BEFORE confirm modal
 *   - Invalid input (amount, date) → throw BEFORE confirm modal (the wart fixed in PR2)
 *   - Decline → no client.send, audit row, return outcome="declined"
 *   - Dry-run → client.send NOT called, audit row, return outcome="dry-run"
 *   - Submit → client.send called once, audit row with vchId, return outcome="submitted"
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postReceipt } from "../../src/operations/post-receipt.js";
import { TallyWriteBlockedError } from "../../src/safety/gates.js";
import { WriteValidationError } from "../../src/operations/validate.js";
import { readAuditEvents } from "../../src/audit/log.js";
import { DEFAULT_CONFIG } from "../../src/config.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-tally-postr-"));
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

function mockClient(responseBody: string) {
  const send = vi.fn().mockResolvedValue(responseBody);
  return { send } as any;
}

const validInput = {
  company: "Co",
  party: "Acme",
  destinationLedger: "Cash",
  date: "2026-06-01",
  amount: 100,
};

describe("postReceipt — pre-confirm enforcement", () => {
  it("throws TallyWriteBlockedError when vouchers gate is closed (before confirm)", async () => {
    const { ctx, confirm } = mockCtx(true);
    const client = mockClient("");
    await expect(
      postReceipt(ctx as any, cfgWithVouchers(false), client, dir, validInput),
    ).rejects.toThrow(TallyWriteBlockedError);
    expect(confirm).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it("rejects amount<=0 BEFORE confirm modal (PR2 wart fix)", async () => {
    const { ctx, confirm } = mockCtx(true);
    const client = mockClient("");
    await expect(
      postReceipt(ctx as any, cfgWithVouchers(true), client, dir, {
        ...validInput,
        amount: -10,
      }),
    ).rejects.toThrow(WriteValidationError);
    expect(confirm).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it("rejects malformed date BEFORE confirm modal", async () => {
    const { ctx, confirm } = mockCtx(true);
    const client = mockClient("");
    await expect(
      postReceipt(ctx as any, cfgWithVouchers(true), client, dir, {
        ...validInput,
        date: "yesterday",
      }),
    ).rejects.toThrow(WriteValidationError);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("postReceipt — confirm/decline/submit branches", () => {
  it("returns outcome=declined and writes audit when user declines", async () => {
    const { ctx } = mockCtx(false);
    const client = mockClient("");
    const r = await postReceipt(ctx as any, cfgWithVouchers(true), client, dir, validInput);
    expect(r.outcome).toBe("declined");
    expect(client.send).not.toHaveBeenCalled();
    const events = readAuditEvents(dir);
    expect(events.some((e) => e.kind === "write.declined")).toBe(true);
  });

  it("returns outcome=dry-run, skips client.send, writes audit", async () => {
    const { ctx } = mockCtx(true);
    const client = mockClient("");
    const r = await postReceipt(ctx as any, cfgWithVouchers(true), client, dir, {
      ...validInput,
      dryRun: true,
    });
    expect(r.outcome).toBe("dry-run");
    expect(client.send).not.toHaveBeenCalled();
    const events = readAuditEvents(dir);
    expect(events.some((e) => e.kind === "write.dry-run")).toBe(true);
    expect(events.some((e) => e.kind === "write.confirmed")).toBe(true);
  });

  it("returns outcome=submitted with vchId on success", async () => {
    const { ctx } = mockCtx(true);
    const client = mockClient(
      `<RESPONSE><CREATED>1</CREATED><LASTVCHID>9001</LASTVCHID></RESPONSE>`,
    );
    const r = await postReceipt(ctx as any, cfgWithVouchers(true), client, dir, validInput);
    expect(r.outcome).toBe("submitted");
    expect(r.vchId).toBe("9001");
    expect(client.send).toHaveBeenCalledOnce();
    const events = readAuditEvents(dir);
    expect(events.some((e) => e.kind === "write.submitted")).toBe(true);
  });

  it("throws when Tally accepts envelope but CREATED=0 (no-op)", async () => {
    const { ctx } = mockCtx(true);
    const client = mockClient(`<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED></RESPONSE>`);
    await expect(
      postReceipt(ctx as any, cfgWithVouchers(true), client, dir, validInput),
    ).rejects.toThrow(/no voucher/i);
    const events = readAuditEvents(dir);
    expect(events.some((e) => e.kind === "write.no-op")).toBe(true);
  });
});
