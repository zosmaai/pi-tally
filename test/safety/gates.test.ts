/**
 * Ring 1 — per-category write gates.
 *
 * Contract:
 *   - assertGate(cfg, category) returns void if the gate is OPEN
 *   - throws TallyWriteBlockedError with code "GATE_CLOSED" if CLOSED
 *   - error carries category + the exact /tally command to open it
 *   - the error message is LLM-readable: an LLM that catches it must know
 *     what to ask the user, and not be tempted to retry
 */

import { describe, expect, it } from "vitest";
import { assertGate, TallyWriteBlockedError } from "../../src/safety/gates.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import type { TallyConfig } from "../../src/config.js";

function cfg(overrides: Partial<TallyConfig["writeGates"]> = {}): TallyConfig {
  return {
    ...DEFAULT_CONFIG,
    writeGates: { ...DEFAULT_CONFIG.writeGates, ...overrides },
  };
}

describe("assertGate", () => {
  it("passes silently when the requested gate is open", () => {
    expect(() => assertGate(cfg({ vouchers: true }), "vouchers")).not.toThrow();
  });

  it("throws TallyWriteBlockedError when the gate is closed", () => {
    expect(() => assertGate(cfg(), "vouchers")).toThrowError(TallyWriteBlockedError);
  });

  it("error carries the category and a structured GATE_CLOSED code", () => {
    try {
      assertGate(cfg(), "masters");
      expect.fail("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TallyWriteBlockedError);
      const err = e as TallyWriteBlockedError;
      expect(err.code).toBe("GATE_CLOSED");
      expect(err.category).toBe("masters");
      expect(err.userAction).toBe("/tally enable-writes masters");
    }
  });

  it("does not leak across categories — opening vouchers does not open masters", () => {
    expect(() => assertGate(cfg({ vouchers: true }), "masters")).toThrowError(
      TallyWriteBlockedError,
    );
  });

  it("rawXml gate uses kebab-case in the user-facing command hint", () => {
    try {
      assertGate(cfg(), "rawXml");
      expect.fail("expected to throw");
    } catch (e) {
      expect((e as TallyWriteBlockedError).userAction).toBe("/tally enable-writes raw-xml");
    }
  });

  it("bulkImport gate uses kebab-case in the user-facing command hint", () => {
    try {
      assertGate(cfg(), "bulkImport");
      expect.fail("expected to throw");
    } catch (e) {
      expect((e as TallyWriteBlockedError).userAction).toBe("/tally enable-writes bulk-import");
    }
  });

  it("error message is short and instructive — LLM should not retry", () => {
    try {
      assertGate(cfg(), "vouchers");
      expect.fail("expected to throw");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/write gate .* is closed/i);
      expect(msg).toMatch(/vouchers/);
      expect(msg).toMatch(/\/tally enable-writes vouchers/);
      // Must NOT suggest retry — LLM should ask user, not loop
      expect(msg.toLowerCase()).not.toMatch(/retry|try again|automatically/);
    }
  });
});
